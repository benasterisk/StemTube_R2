"""
Recording CRUD operations.

Manages user recordings stored alongside extracted stems.
Each recording belongs to a user and is associated with a global download.
Uses SQLAlchemy ORM — all queries go through db.session.
"""
import uuid

from core.models import db, Recording, model_to_dict


def init_recordings_table():
    """No-op — table created by SQLAlchemy models via db.create_all()."""
    pass


def create_recording(user_id, download_id, name, start_offset, filename):
    """Insert a new recording and return its id."""
    rec_id = uuid.uuid4().hex[:16]
    recording = Recording(
        id=rec_id,
        user_id=str(user_id),
        download_id=str(download_id),
        name=name,
        start_offset=start_offset,
        filename=filename,
    )
    db.session.add(recording)
    db.session.commit()
    return rec_id


def list_recordings(user_id, download_id):
    """Return all recordings for a given user and download."""
    rows = (
        Recording.query
        .filter_by(user_id=str(user_id), download_id=str(download_id))
        .order_by(Recording.created_at.asc())
        .all()
    )
    return [model_to_dict(r) for r in rows]


def get_recording(recording_id):
    """Return a single recording by id, or None."""
    recording = db.session.get(Recording, recording_id)
    return model_to_dict(recording)


def rename_recording(recording_id, user_id, new_name):
    """Rename a recording. Only the owner can rename."""
    recording = Recording.query.filter_by(id=recording_id, user_id=str(user_id)).first()
    if recording:
        recording.name = new_name
        db.session.commit()


def delete_recording(recording_id, user_id):
    """Delete a recording row. Only the owner can delete. Returns True if deleted."""
    recording = Recording.query.filter_by(id=recording_id, user_id=str(user_id)).first()
    if recording:
        db.session.delete(recording)
        db.session.commit()
        return True
    return False
