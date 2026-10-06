# AI study help and quiz drafting: what it does and what it cannot do

Applies to Milestone 5. Written for faculty, administrators and the students' own understanding.

## What the AI is used for

1. **Study help (students).** A subject-scoped chat. It answers only from the published lessons, files and approved reference text of the student's own subject, and shows which material each answer came from.
2. **Quiz drafting (faculty).** Faculty pick published materials; the AI proposes questions. The result is always an unpublished **draft**. It cannot be published until faculty mark the latest version as reviewed.

Nothing else. The AI never grades, never decides a result, never changes a score, and never sees student names, scores, answers, other subjects or other students' chats.

## What the AI can read (retrieval allow-list)

Current **published** revisions of learning items (lessons, files with readable text, reference links whose text a teacher approved), not archived, in the student's own offering and targeted at the student's section.

It cannot read: drafts, archived items, quizzes and questions, answer keys and explanations, submissions, scores, feedback, grade releases or snapshots, announcements, other offerings, or other students' chats. Only learning items are ever chunked, so this is enforced by construction and by a query that re-checks the published revision at question time.

## Honest limitations

### It cannot prevent cheating

- A student can still copy a quiz question into the study chat. The assistant is instructed not to give answers to graded work and to explain the concept instead, and the chat **pauses while the student has an open quiz attempt** in that subject (the student sees why). These are speed bumps, not locks: the student can use another device or another tool.
- Online quizzes are not proctored. LearnSync does not detect copying, sharing or outside help. Faculty who need integrity should use supervised or paper assessments, shorter time windows, several attempts with the lowest stakes, or question wording that needs the student's own reasoning.
- Short-answer matching is exact after normalisation; it can be gamed by guessing common wording, and it can reject a correct answer worded differently (faculty can correct single answers with a reason).
- Chat logs are private to the student by design. Faculty see progress counts only, so they cannot audit AI use.

### It can be wrong (and how answers are checked)

Study answers are checked by the server before a student sees them, because the real model was observed (during live testing) answering from general knowledge, writing wrong or missing source tags and once attaching a false tag to an outside explanation:

1. The model must return its answer together with word-for-word quotes, one for every source it cites. The server checks that each quote is literally present in that source (ignoring case and spacing). An invented quote or tag makes the reply untrusted.
2. A second, narrow request asks whether the cited passages state everything the answer says (a source that merely *mentions* a term does not support a definition, formula, steps or an example). If it says no, or cannot be understood, the answer is not shown.
3. An untrusted reply gets one repair attempt. Anything still unverified is replaced by an honest message: "I couldn't produce a reliably supported answer", "I couldn't find enough information in your published materials", or, for requests for answers to graded work, a friendly decline. Students see "Where this came from" with the verified quotes.

What this does NOT guarantee (state this to users):
- A literal quote proves a passage exists, not that it supports every claim. The checking request uses the same model, so it can accept an explanation that goes beyond the material. Treat the words around a quote as the assistant's own and check them against the lesson.
- Retrieval can miss relevant material, so a refusal does not prove the course contains no answer. Occasional refusals of answerable questions are the accepted cost of not showing unsupported answers.
- Language quality and correctness still need human review: only English was judged by the developer; Filipino and Taglish answers and drafted questions are pending review by a fluent reader.
- Assessment isolation (the chat never sees quiz content and pauses during an open attempt) cannot stop cheating with outside tools.

### Capacity and provider limits

Measured with the project's own key and `openai/gpt-oss-20b` (observed for that account and model, not universal Groq limits): 8,000 tokens per minute and 1,000 requests per day. Each answer costs one request plus a small checking request (and a repair request when needed), so only a few questions a minute fit; quiz drafting and chat share the same budget. When the provider says it is busy the app stops sending requests for the provider's retry time (bounded, shared by all users), keeps the student's question, and shows a short "try again in a minute" message; it never retries a rate limit as if it were bad content. This account's measurements do not establish whole-class capacity. Whether another tier would is unknown.

### Drafted quizzes need a human

- Every AI quiz is checked structurally (counts, four different choices, one correct choice, accepted answers, a real source) and rejected whole if anything fails; nothing partial is saved.
- Passing those checks does **not** make a question correct, fair or well worded. Faculty must read every question and answer. Editing a question afterwards cancels the review.
- Questions are drafted only from the chosen sources, but the model may still use outside knowledge or write a weak distractor.

### Language

Faculty choose the quiz language when drafting (same as the materials, English, Filipino or Taglish); the choice is saved with the draft and shown on the review screen with a reminder to check the language as well as the content. A wrong-language draft stays unpublished and can be discarded and drafted again. One draft in live testing came back in French from English materials before the explicit setting existed; none did in the three tries after it, which is encouraging, not a guarantee. Study answers follow the language of the student's question.

### Data sent to the provider

When AI is enabled, the text of the chosen materials plus the student's question (study help) is sent to Groq. Student names, numbers, scores and other accounts are not. Do not publish personal data in lessons. The provider key lives only in the server environment.

### A friendly assistant that still does not guess

Study help is warm without loosening the grounding rules (Codex #20). Greetings ("Hi", "Kumusta po"), thanks and "what can you do?" are answered **without calling the AI provider** by fixed English or Filipino text that states no course or general-knowledge fact, followed by up to three lessons the student can already open. A message counts as small talk only when every word is a pleasantry, so "Hi, give me the quiz answers" is handled as a real question. When a question cannot be answered (nothing in the materials, an unverifiable answer, a request for graded-work answers) the honest message stays, in a friendlier voice, and ends with lesson buttons from the database at reply time (published, not archived, targeted at the student's section), never from model text. They are labelled **"Related lessons you could explore"** when they come from the retrieved passages or matching titles, and **"Your next published lessons"** when they are only the next lessons in the student's sequence; neither is a citation and neither claims the lesson answers the question. Verified answers still need quotes and the support check, exactly as before. Suggestions are stored apart from sources (`study_message.suggestions`) and deleted with the conversation.

### Lesson helpers: explain simply, summarize, example, analogy

One-tap actions work on ONE lesson (the one chosen under "Focus on", else the student's next lesson), so they no longer depend on keyword search. The server builds the message from the lesson title, retrieves only that lesson's own published passages, and sends no chat history. **Explain simply**, **Summarize** and **Give an example** are grounded exactly like a typed question: [S#] tags, verbatim quotes, the support check and one repair; failure gives the honest non-answer with lesson buttons. "Give an example" must use an example that is written in the lesson; if the model says there is none the student is told so, but a model can still restate the lesson as an "example", so that outcome is not guaranteed. **Everyday analogy** shows a grounded simple explanation plus ONE short comparison that is clearly labelled "illustrative, not from the lesson". The analogy is shown only when the explanation passed grounding AND the same support call judged it faithful and free of new facts; it is dropped (with a plain note) otherwise. Deterministic guards run first: no digits, links or source tags, 600 characters at most. Limits: the analogy check is the same model checking itself, so a misleading comparison can slip through, which is why it is labelled and the lesson remains the reference; a lesson with no readable text cannot be explained (the student is told); a one-sentence lesson gets a one-sentence answer. Real-model sample on the dev data (small, not a guarantee): simplify 5 of 5 answered after the prompt allowed short lessons (3 of 5 before), summarize 2 of 2, analogy 5 of 6 with sensible comparisons and the other an honest non-answer. Filipino and Taglish analogies were not reviewed by a fluent reader.

### Study chats: privacy and deletion

Chats are per subject and private to the student: faculty see progress counts and administrators have no read route. A student can delete a whole conversation; the messages and the sources saved on them are removed from the database, and the audit trail keeps only that a deletion happened and how many messages it held. Withdrawn students and students of closed terms can read and delete their own history but cannot ask new questions. Deleted chats can remain in backups until those expire (a backup is a full copy of the database), and the text of a question and the passages needed to answer it were already sent to the AI provider when it was asked, so deletion in LearnSync does not recall that. There is no automatic expiry because no retention period has been confirmed by the institution; deactivating an account revokes its sessions but does not delete its chats.

### Availability

If the provider is down, slow or the key is missing, students and faculty see a short safe message and nothing is saved by mistake. A retried question is not stored or answered twice.

## Development simulator

`AI_PROVIDER_MODE=fake` (honoured only when `APP_ENV=development`) replaces Groq with a mechanical simulator so the screens can be exercised without a key. The UI and `/api/ai/status` label it. It proves the plumbing, **not** answer quality, language handling or safety.
