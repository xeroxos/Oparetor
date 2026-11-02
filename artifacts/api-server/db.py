import os
import json
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.db')


def init_app(app):
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {'id': self.id, 'email': self.email, 'created_at': self.created_at.isoformat()}


class UIDEntry(db.Model):
    __tablename__ = 'uid_entries'
    id = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    uid = db.Column(db.String(64), nullable=False, index=True)
    password = db.Column(db.String(255), nullable=True)
    name = db.Column(db.String(255), nullable=True)
    username = db.Column(db.String(255), nullable=True)
    avatar_url = db.Column(db.Text, nullable=True)
    follower_count = db.Column(db.String(64), nullable=True)
    status = db.Column(db.String(32), default='pending')
    account_status = db.Column(db.String(32), nullable=True)
    account_checked_at = db.Column(db.BigInteger, nullable=True)
    fail_count = db.Column(db.Integer, default=0)
    check_count = db.Column(db.Integer, default=0)
    starred = db.Column(db.Boolean, default=False)
    tags_json = db.Column(db.Text, default='[]')
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.BigInteger, nullable=False)
    fetched_at = db.Column(db.BigInteger, nullable=True)

    __table_args__ = (db.UniqueConstraint('user_id', 'uid', name='uq_user_uid'),)

    def to_dict(self):
        try:
            tags = json.loads(self.tags_json or '[]')
        except Exception:
            tags = []
        return {
            'id': self.id,
            'uid': self.uid,
            'password': self.password,
            'name': self.name,
            'username': self.username,
            'avatarUrl': self.avatar_url,
            'followerCount': self.follower_count,
            'status': self.status,
            'accountStatus': self.account_status,
            'accountCheckedAt': self.account_checked_at,
            'failCount': self.fail_count or 0,
            'checkCount': self.check_count or 0,
            'starred': bool(self.starred),
            'tags': tags,
            'note': self.note,
            'createdAt': self.created_at,
            'fetchedAt': self.fetched_at,
        }

    def apply_updates(self, data: dict):
        mapping = {
            'password': 'password',
            'name': 'name',
            'username': 'username',
            'avatarUrl': 'avatar_url',
            'followerCount': 'follower_count',
            'status': 'status',
            'accountStatus': 'account_status',
            'accountCheckedAt': 'account_checked_at',
            'failCount': 'fail_count',
            'checkCount': 'check_count',
            'starred': 'starred',
            'note': 'note',
            'fetchedAt': 'fetched_at',
        }
        for k, col in mapping.items():
            if k in data:
                setattr(self, col, data[k])
        if 'tags' in data:
            self.tags_json = json.dumps(data['tags'] or [])
