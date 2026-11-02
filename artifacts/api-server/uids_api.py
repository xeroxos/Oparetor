from flask import Blueprint, request, jsonify, g
from sqlalchemy.exc import IntegrityError
from db import db, UIDEntry
from auth import require_auth

uids_bp = Blueprint('uids', __name__)


@uids_bp.route('', methods=['GET'])
@require_auth
def list_uids():
    rows = (UIDEntry.query
            .filter_by(user_id=g.user.id)
            .order_by(UIDEntry.created_at.desc())
            .all())
    return jsonify({'success': True, 'entries': [r.to_dict() for r in rows]})


@uids_bp.route('', methods=['POST'])
@require_auth
def create_uids():
    data = request.get_json() or {}
    items = data.get('entries') or []
    if not isinstance(items, list):
        return jsonify({'success': False, 'error': 'entries must be a list'}), 400

    existing_uids = {
        u.uid for u in UIDEntry.query
        .filter_by(user_id=g.user.id)
        .with_entities(UIDEntry.uid).all()
    }
    created = []
    for it in items:
        uid_str = (it.get('uid') or '').strip()
        if not uid_str or uid_str in existing_uids:
            continue
        existing_uids.add(uid_str)
        row = UIDEntry(
            id=it['id'],
            user_id=g.user.id,
            uid=uid_str,
            password=it.get('password'),
            status='pending',
            created_at=it.get('createdAt'),
            tags_json='[]',
        )
        db.session.add(row)
        created.append(row)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        # Concurrent create: re-read what's actually in DB for the requested UIDs
        wanted_uids = [it.get('uid') for it in items if it.get('uid')]
        existing = UIDEntry.query.filter(
            UIDEntry.user_id == g.user.id,
            UIDEntry.uid.in_(wanted_uids),
        ).all()
        return jsonify({'success': True, 'created': [r.to_dict() for r in existing]})
    return jsonify({'success': True, 'created': [r.to_dict() for r in created]})


@uids_bp.route('/<entry_id>', methods=['PATCH'])
@require_auth
def update_uid(entry_id):
    row = UIDEntry.query.filter_by(id=entry_id, user_id=g.user.id).first()
    if not row:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    data = request.get_json() or {}
    row.apply_updates(data)
    db.session.commit()
    return jsonify({'success': True, 'entry': row.to_dict()})


@uids_bp.route('/<entry_id>', methods=['DELETE'])
@require_auth
def delete_uid(entry_id):
    row = UIDEntry.query.filter_by(id=entry_id, user_id=g.user.id).first()
    if not row:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    db.session.delete(row)
    db.session.commit()
    return jsonify({'success': True})


@uids_bp.route('', methods=['DELETE'])
@require_auth
def clear_all():
    UIDEntry.query.filter_by(user_id=g.user.id).delete()
    db.session.commit()
    return jsonify({'success': True})
