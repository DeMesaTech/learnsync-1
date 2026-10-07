from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.security import require_role

from .admin import admin_dashboard
from .faculty import faculty_dashboard
from .student import student_dashboard, student_todo

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])
student, faculty, admin = require_role("student"), require_role("faculty"), require_role("admin")


@router.get("/student")
def student_home(actor=Depends(student), db: Session = Depends(get_db)):
    return student_dashboard(db, actor)


@router.get("/student/todo")
def student_todo_list(actor=Depends(student), db: Session = Depends(get_db)):
    return student_todo(db, actor)


@router.get("/faculty")
def faculty_home(actor=Depends(faculty), db: Session = Depends(get_db)):
    return faculty_dashboard(db, actor)


@router.get("/admin")
def admin_home(actor=Depends(admin), db: Session = Depends(get_db)):
    return admin_dashboard(db, actor)
