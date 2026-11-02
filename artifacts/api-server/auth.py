import os
import jwt
import bcrypt
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, request, jsonify, g

from db import db, User

auth_bp = Blueprint('auth', __name__)

JWT_SECRET = os.environ.get('JWT_SECRET')
if not JWT_SECRET:
    import secrets, sys
    JWT_SECRET = secrets.token_urlsafe(32)
    print('WARNING: JWT_SECRET env var not set — using random ephemeral secret. '
          'Tokens will be invalidated on every restart. Set JWT_SECRET for production.',
          file=sys.stderr)
JWT_EXPIRY_DAYS = 30


def make_token(user_id: int) -> str:
    payload = {
        'sub': str(user_id),
        'exp': datetime.utcnow() + timedelta(days=JWT_EXPIRY_DAYS),
        'iat': datetime.utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


def decode_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        return int(payload['sub'])
    except Exception:
        return None


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return jsonify({'success': False, 'error': 'Missing token'}), 401
        token = header[7:].strip()
        user_id = decode_token(token)
        if not user_id:
            return jsonify({'success': False, 'error': 'Invalid or expired token'}), 401
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({'success': False, 'error': 'User not found'}), 401
        g.user = user
        return f(*args, **kwargs)
    return wrapper


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or '@' not in email:
        return jsonify({'success': False, 'error': 'Valid email required'}), 400
    if len(password) < 6:
        return jsonify({'success': False, 'error': 'Password must be at least 6 characters'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'error': 'Email already registered'}), 409
    pw_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    user = User(email=email, password_hash=pw_hash)
    db.session.add(user)
    db.session.commit()
    token = make_token(user.id)
    return jsonify({'success': True, 'token': token, 'user': user.to_dict()})


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    user = User.query.filter_by(email=email).first()
    if not user or not bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
        return jsonify({'success': False, 'error': 'Invalid email or password'}), 401
    token = make_token(user.id)
    return jsonify({'success': True, 'token': token, 'user': user.to_dict()})


@auth_bp.route('/me', methods=['GET'])
@require_auth
def me():
    return jsonify({'success': True, 'user': g.user.to_dict()})
