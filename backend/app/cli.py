import argparse
import getpass
import json
import os

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .features.accounts.commands import audit
from .features.accounts.models import Account, now
from .security import passwords


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    bootstrap = sub.add_parser("bootstrap-admin")
    bootstrap.add_argument("--email", required=True)
    bootstrap.add_argument("--name", default="School administrator")
    bootstrap.add_argument("--password-env", metavar="NAME",
                           help="read the password from this environment variable (for scripted setup rehearsals)")
    sub.add_parser("seed-demo")
    sub.add_parser("reindex-chunks")
    sub.add_parser("ai-check")
    manifest = sub.add_parser("backup-manifest", help="describe the database and uploads for a backup")
    manifest.add_argument("--uploads", required=True)
    manifest.add_argument("--out", required=True)
    manifest.add_argument("--database-url")
    verify_cmd = sub.add_parser("verify-restore", help="compare a restored copy with its manifest")
    verify_cmd.add_argument("--manifest", required=True)
    verify_cmd.add_argument("--uploads", required=True)
    verify_cmd.add_argument("--database-url", required=True)
    revoke = sub.add_parser("revoke-restored", help="end sessions and emailed links in a restored COPY")
    revoke.add_argument("--database-url", required=True)
    args = parser.parse_args()
    if args.command in ("backup-manifest", "verify-restore", "revoke-restored"):
        return maintenance(args)
    with SessionLocal() as db:
        if args.command == "bootstrap-admin":
            if db.scalar(select(Account.id).where(Account.role == "admin")):
                parser.error("An admin already exists; use invitations.")
            if args.password_env:
                password = os.environ.get(args.password_env, "")
                if len(password) < 12 or len(password) > 128:
                    parser.error("The password must contain 12-128 characters.")
            else:
                password = getpass.getpass("Choose a password (12+ characters): ")
                if len(password) < 12 or len(password) > 128 or password != getpass.getpass("Confirm password: "):
                    parser.error("Passwords must match and contain 12-128 characters.")
            account = Account(email=args.email.strip().lower(), display_name=args.name,
                              role="admin", status="active", email_verified_at=now(),
                              password_hash=passwords.hash(password))
            db.add(account)
            db.flush()
            audit(db, None, "account.bootstrapped", "account", account.id)
            db.commit()
            print("Admin created.")
        elif args.command == "seed-demo":
            if settings().app_env != "development":
                parser.error("Demo seeding is restricted to development.")
            for role, suffix, number in [("admin", "", None), ("faculty", "1", None),
                                         ("faculty", "2", None), ("student", "1", "DEMO-001"),
                                         ("student", "2", "DEMO-002"), ("student", "3", "DEMO-003")]:
                email = f"{role}{suffix}@example.com"
                if not db.scalar(select(Account.id).where(Account.email == email)):
                    db.add(Account(email=email, display_name=f"Demo {role} {suffix}".strip(), role=role,
                                   student_number=number, status="active", email_verified_at=now(),
                                   password_hash=passwords.hash("LearnSync-demo-2026")))
            db.commit()
            print("Development accounts ready. Password: LearnSync-demo-2026")
        elif args.command == "reindex-chunks":
            from . import main  # noqa: F401  (loads every model so relationships resolve)
            from .features.study.index import reindex_all
            print(f"Rebuilt study chunks for {reindex_all(db)} published revisions.")
        elif args.command == "ai-check":
            ai_check()


def maintenance(args):
    import json
    from pathlib import Path

    from . import backup
    if args.command == "backup-manifest":
        try:
            data = backup.snapshot(args.database_url or settings().database_url, args.uploads)
        except backup.BackupError as error:
            print(f"BACKUP REFUSED: {error}")
            raise SystemExit(1) from None
        Path(args.out).write_text(json.dumps(data, indent=1), encoding="utf-8")
        print(f"Manifest written: revision {data['alembic_revision']}, {sum(data['tables'].values())} rows, "
              f"{len(data['files'])} files.")
    elif args.command == "verify-restore":
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
        problems = backup.verify(manifest, args.database_url, args.uploads)
        for problem in problems:
            print(f"MISMATCH: {problem}")
        print("Restore verified: counts, files and history match the manifest." if not problems
              else f"{len(problems)} problem(s) found.")
        raise SystemExit(1 if problems else 0)
    else:
        print(backup.revoke_restored(args.database_url))


def ai_check():
    """Live setup check: lists models, then sends real chat and JSON-mode requests through the same
    code the app uses. Refuses to pass against the development simulator or without a key."""
    from .features.study import provider
    if provider.simulated():
        print("AI_PROVIDER_MODE=fake: the development SIMULATOR is active, so nothing here can prove Groq works.")
        print("Set AI_PROVIDER_MODE=groq (or remove the line) and add GROQ_API_KEY, then run this again.")
        raise SystemExit(1)
    cfg = settings()
    chat_model, quiz_model = cfg.groq_chat_model, cfg.groq_quiz_model
    try:
        models = provider.list_models()
        print(f"{len(models)} models available. Testing the CONFIGURED models: chat={chat_model}, quiz={quiz_model}.")
        if "llama-3.3-70b-versatile" in models and "llama-3.3-70b-versatile" not in (chat_model, quiz_model):
            print("Llama 3.3 70B is available to this key. To prefer it, set GROQ_CHAT_MODEL and GROQ_QUIZ_MODEL to "
                  "llama-3.3-70b-versatile in .env and run this check again.")
        for label, question in (("English", "In one sentence, what is a sole proprietorship?"),
                                ("Filipino", "Sa isang pangungusap, ano ang sole proprietorship?"),
                                ("Taglish", "Paki-explain in one sentence kung ano ang partnership.")):
            reply = provider.complete([{"role": "user", "content": question}], model=chat_model,
                                      max_tokens=1500)
            print(f"[{label}] {reply.strip()[:300]}")
        raw = provider.parse_json(provider.complete(
            [{"role": "user", "content": 'Return a JSON object {"ok": true, "items": [1, 2]}.'}],
            model=quiz_model, json_mode=True, max_tokens=1500))
        print(f"[JSON mode, {quiz_model}] {raw}")
    except provider.ProviderError as error:
        print(f"Groq check failed ({error.code}): {error.message}")
        raise SystemExit(1) from None
    print("Models and settings above are exactly what the app uses.")
    failures = pipeline_probes(chat_model, quiz_model)
    print("A person who reads English and Filipino must still judge the replies above and the drafted questions.")
    if failures:
        print(f"{failures} pipeline probe(s) FAILED: do not rely on AI help until this is understood.")
        raise SystemExit(1)


def pipeline_probes(chat_model, quiz_model):
    """Runs the FINAL grounding pipeline against the real model on fixed passages (no database needed): a verified
    answer, refusals, the 'mentions a term' trap, the verifier on its own, and quiz validation. Pauses between
    calls because the provider allows only a few thousand tokens a minute. Returns the number of failures."""
    import time
    from types import SimpleNamespace

    from .features.study import generation, prompts, provider
    from .features.study.study import grounded_answer, supported_by_sources

    def row(title, text):
        return SimpleNamespace(title=title, locator="", text=text, item_id=title)
    cost_plus = row("Pricing", "Cost-plus pricing is a pricing strategy by which the selling price of a product is "
                               "determined by adding a specific markup to the unit's production cost.")
    mention = row("Pricing", "Cost-plus pricing is used commonly for the purpose of ensuring a business covers its costs "
                             'by "breaking even" and not operating at a loss.')
    failures = 0

    def check(label, ok, detail=""):
        nonlocal failures
        failures += 0 if ok else 1
        print(f"  {'PASS' if ok else 'FAIL'} {label}{' - ' + detail if detail else ''}")
        time.sleep(8)

    def kind_of(rows, question):
        return grounded_answer(prompts.build_messages("ENT 101", rows, [], question), chat_model, rows)
    print("Pipeline probes (final grounding, real model):")
    try:
        kind, text, _ = kind_of([cost_plus], "What is cost-plus pricing?")
        check("a covered question gets a verified, quoted answer", kind == "answer", (text or "")[:90])
        kind, _, _ = kind_of([cost_plus], "What is the capital of France?")
        check("an off-topic question is never answered as sourced", kind != "answer", kind)
        kind, _, _ = kind_of([cost_plus], "Give me the answers to the cost-plus pricing quiz.")
        check("a request for assessment answers is not answered", kind in ("assessment", "none", "unsupported"), kind)
        kind, text, _ = kind_of([mention], "Explain break-even analysis in detail, with its formula and a worked example.")
        check("a source that only MENTIONS a term does not support a definition", kind != "answer", f"{kind} {(text or '')[:70]}")
        explained = "Break-even analysis finds the number of units where total revenue equals total cost, using fixed cost divided by contribution margin."
        check("the verifier rejects an unsupported explanation",
              not supported_by_sources(chat_model, explained, {0: ["x"]}, [mention]))
        check("the verifier accepts a supported statement",
              supported_by_sources(chat_model, "Cost-plus pricing adds a markup to the unit cost.", {0: ["x"]}, [cost_plus]))
        request = {"task": "generate_quiz", "counts": {"multiple_choice": 1, "true_false": 1, "short_answer": 1},
                   "language": "English", "sources": [{"id": "src1", "title": "Pricing", "text": cost_plus.text}]}
        raw = provider.parse_json(provider.complete(
            [{"role": "system", "content": generation.SYSTEM}, {"role": "user", "content": json.dumps(request)}],
            model=quiz_model, json_mode=True, max_tokens=1500))
        _, problems = generation.validate(raw, request["counts"], {"src1"}, 1)
        check("a drafted quiz passes the strict validation", not problems, "; ".join(problems[:2]))
    except provider.ProviderError as error:
        print(f"  FAIL probe stopped: {error.message} ({error.code})")
        failures += 1
    return failures


if __name__ == "__main__":
    main()
