"""Adversarial account/save/role contracts with real SQL and HTTP middleware."""

from copy import deepcopy
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import insert, select, text, update

from backend.app.website import schema_v1 as s
from backend.app.website.profile_schema import metadata as profile_metadata
from backend.app.website.profile_schema import user_profiles
from backend.app.website.database import digest, now
from backend.app.website.runtime import install_website

PASSWORD = "a-long-test-password-123"
ORIGIN = "http://localhost:5173"


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        url = os.getenv("ANIMESOUL_TEST_DATABASE_URL") or "sqlite:///" + (Path(self.temporary.name) / "accounts.db").as_posix()
        self.environment = patch.dict("os.environ", {
            "ANIMESOUL_DATABASE_URL": url, "ANIMESOUL_PUBLIC_ORIGIN": ORIGIN,
            "ANIMESOUL_WEBSITE_DEVELOPMENT": "1", "ANIMESOUL_OWNER_EMAIL": "dogemmoze@gmail.com",
            "ANIMESOUL_SMTP_HOST": "smtp.example.test", "ANIMESOUL_SMTP_FROM": "test@example.test",
            "ANIMESOUL_AUTH_GOOGLE_CLIENT_ID": "test-client", "ANIMESOUL_AUTH_GOOGLE_CLIENT_SECRET": "test-secret",
        })
        self.environment.start()
        self.app = FastAPI()
        install_website(self.app)
        self.db = self.app.state.website_database
        self.test_schema = ""
        if self.db.engine.dialect.name == "postgresql":
            self.test_schema = "website_test_" + uuid4().hex
            with self.db.engine.begin() as conn:
                conn.execute(text(f"CREATE SCHEMA {self.test_schema}"))
            self.db.engine = self.db.engine.execution_options(schema_translate_map={None: self.test_schema})
        s.metadata.create_all(self.db.engine)
        profile_metadata.create_all(self.db.engine)
        self.db.seed_roles()
        self.mail = []
        self.mail_patch = patch("backend.app.website.accounts.send_token", side_effect=lambda config, email, token, purpose: self.mail.append((email, token, purpose)))
        self.mail_patch.start()

        @self.app.post("/api/kodik/download")
        @self.app.post("/api/kodik/stream")
        def protected_player():
            return {"ok": True}

        @self.app.get("/api/yummy")
        def public_catalog():
            return {"anime": [{"anime_id": 1, "title": "Public title"}]}

        self.client = self.new_client()

    def tearDown(self):
        self.client.close()
        self.mail_patch.stop()
        if self.test_schema:
            profile_metadata.drop_all(self.db.engine)
            s.metadata.drop_all(self.db.engine)
            with self.db.engine.begin() as conn:
                conn.execute(text(f"DROP SCHEMA {self.test_schema}"))
        self.db.engine.dispose()
        self.environment.stop()
        self.temporary.cleanup()

    def new_client(self):
        return TestClient(self.app, base_url=ORIGIN)

    def mutate(self, client, path, payload=None, method="POST", headers=None):
        user = client.get("/api/auth/me").json()["user"]
        csrf = client.cookies.get("animesoul_csrf", "")
        request_headers = {"Origin": ORIGIN, "X-CSRF-Token": csrf}
        if user:
            request_headers["X-Account-Id"] = user["id"]
        if headers:
            request_headers.update(headers)
        return client.request(method, path, json=payload or {}, headers=request_headers)

    def register(self, client=None, username="alice", email="alice@example.test", verified=True):
        client = client or self.client
        response = self.mutate(client, "/api/auth/register", {"username": username, "email": email, "password": PASSWORD})
        self.assertEqual(response.status_code, 200, response.text)
        token = next(token for address, token, purpose in reversed(self.mail) if address == email and purpose == "verify")
        if verified:
            response = self.mutate(client, "/api/auth/confirm", {"token": token})
            self.assertEqual(response.status_code, 200, response.text)
        return client.get("/api/auth/me").json()["user"]

    def owner(self):
        return self.register(username="dogem", email="dogemmoze@gmail.com")

    def profile_save(self):
        user = self.register()
        document = self.client.get("/api/storage").json()
        document["profiles"][0]["snapshot"] = {
            "favorites": [1, 2], "folders": [{"id": "favorites-folder", "name": "Вечернее", "animeIds": [2], "notes": {"2": "private note"}}],
            "ratings": {"1": {"title": "История", "anime": 9, "seasons": {"1": 8}, "episodes": {"1:1": 7}}},
            "progress": {"1": {"totalEpisodes": 1, "episode": "1", "dub": "private dub", "episodes": {
                "1:1": {"position": 1200, "duration": 1200, "percent": 100, "updatedAt": 1000, "completed": True, "completions": 2, "watchedSeconds": 2400},
                "1:2": {"position": 900, "duration": 1200, "percent": 90, "updatedAt": 2000},
            }}}, "animeTitles": {"1": "private title"},
        }
        self.assertEqual(self.mutate(self.client, "/api/storage", document, method="PUT").status_code, 200)
        return user

    def test_profile_partial_edits_persist_without_changing_roles_or_other_fields(self):
        user = self.register()
        avatar = "/profile-presets/avatar-orbit.svg"
        response = self.mutate(self.client, "/api/auth/profile", {"avatar": avatar, "banner": "/profile-presets/banner-stars.svg", "about": "Люблю аниме", "presence": "dnd", "visibility": {"favorites": True}}, method="PATCH")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"username": "new_name"}, method="PATCH").status_code, 200)
        profile = self.client.get("/api/profiles/me").json()
        self.assertEqual(profile["badges"], [{"id": "member", "name": "Участник", "kind": "member"}])
        self.assertEqual(profile["id"], user["id"])
        self.assertEqual(profile["username"], "new_name")
        self.assertEqual(profile["avatar"], avatar)
        self.assertEqual(profile["about"], "Люблю аниме")
        self.assertEqual(profile["presence"], "dnd")
        self.assertTrue(profile["visibility"]["favorites"])
        self.assertFalse(profile["visibility"]["ratings"])
        account = self.client.get("/api/auth/me").json()["user"]
        self.assertEqual(account["avatar"], avatar)
        self.assertEqual(account["roles"], user["roles"])
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"avatar": "", "banner": ""}, method="PATCH").status_code, 200)
        self.assertEqual(self.client.get("/api/profiles/me").json()["avatar"], "")

    def test_public_profile_omits_private_sections_even_for_owner_and_guests(self):
        user = self.profile_save()
        own = self.client.get("/api/profiles/me").json()
        self.assertEqual(own["sections"]["favorites"], [1, 2])
        public_url = f"/api/profiles/{user['id']}"
        public = self.client.get(public_url).json()
        self.assertEqual(public["sections"], {})
        for key in ["email", "emailVerified", "permissions", "visibility", "googleLinked", "hasPassword"]:
            self.assertNotIn(key, public)
        guest = self.new_client()
        try:
            self.assertEqual(guest.get(public_url).json()["sections"], {})
            self.assertEqual(guest.get("/api/profiles/me").status_code, 401)
            self.assertEqual(self.mutate(guest, "/api/auth/profile", {"about": "attack"}, method="PATCH").status_code, 401)
        finally:
            guest.close()

    def test_public_projection_exposes_only_selected_sections_and_safe_folder_fields(self):
        user = self.profile_save()
        visibility = {"about": False, "favorites": True, "collections": True, "ratings": True, "statistics": True}
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"about": "secret about", "visibility": visibility}, method="PATCH").status_code, 200)
        public = self.client.get(f"/api/profiles/{user['id']}").json()
        self.assertIsNone(public["about"])
        self.assertEqual(public["sections"]["collections"], [{"id": "favorites-folder", "name": "Вечернее", "animeIds": [2]}])
        self.assertEqual(public["sections"]["ratings"], [{"animeId": 1, "title": "История", "score": 9}])
        self.assertEqual(public["sections"]["statistics"], {"titles": 1, "episodes": 2, "watchSeconds": 3300})
        self.assertNotIn("private", str(public))
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"visibility": {"collections": False}}, method="PATCH").status_code, 200)
        public = self.client.get(f"/api/profiles/{user['id']}").json()
        self.assertNotIn("collections", public["sections"])
        self.assertIn("favorites", public["sections"])

    def test_presence_invisibility_and_heartbeat_expiry(self):
        user = self.register()
        public_url = f"/api/profiles/{user['id']}"
        for presence in ["online", "offline", "dnd", "invisible"]:
            self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"presence": presence}, method="PATCH").status_code, 200)
            self.assertEqual(self.client.get("/api/profiles/me").json()["presence"], presence)
            self.assertEqual(self.client.get(public_url).json()["presence"], "offline" if presence == "invisible" else presence)
            self.assertEqual(self.mutate(self.client, "/api/profiles/presence").status_code, 200)
            self.assertEqual(self.client.get("/api/profiles/me").json()["presence"], presence)
        self.mutate(self.client, "/api/auth/profile", {"presence": "dnd"}, method="PATCH")
        with self.db.engine.begin() as conn:
            conn.execute(update(user_profiles).where(user_profiles.c.user_id == user["id"]).values(last_seen_at=now() - 181))
        self.assertEqual(self.client.get(public_url).json()["presence"], "offline")
        self.assertEqual(self.client.get("/api/profiles/me").json()["presence"], "dnd")
        self.mutate(self.client, "/api/profiles/presence")
        self.assertEqual(self.client.get(public_url).json()["presence"], "dnd")

    def test_profile_validation_rejects_unsafe_media_role_edits_and_invalid_status(self):
        self.register()
        for payload in [{"avatar": "javascript:alert(1)"}, {"banner": "http://images.example.test/gif"},
                        {"avatar": "data:image/svg+xml;base64,PHN2Zz4="}, {"avatar": "data:image/gif;base64,not-a-gif"},
                        {"avatar": "https://user:password@example.test/a.gif"}, {"presence": "admin"},
                        {"roles": ["owner"]}, {"visibility": {"ratings": "false"}}, {"visibility": {"unknown": True}},
                        {"about": "a" * 601}, {}]:
            with self.subTest(payload=str(payload)[:80]):
                self.assertEqual(self.mutate(self.client, "/api/auth/profile", payload, method="PATCH").status_code, 422)

    def test_profiles_are_isolated_and_use_active_save_profile(self):
        alice = self.profile_save()
        document = self.client.get("/api/storage").json()
        document["profiles"].append({"id": "other", "name": "Other", "snapshot": {"favorites": [42]}})
        document["activeProfile"] = "other"
        self.assertEqual(self.mutate(self.client, "/api/storage", document, method="PUT").status_code, 200)
        self.assertEqual(self.client.get("/api/profiles/me").json()["sections"]["favorites"], [42])
        other = self.new_client()
        try:
            bob = self.register(other, "bob", "bob@example.test")
            self.mutate(other, "/api/auth/profile", {"about": "Bob"}, method="PATCH")
            self.assertEqual(other.get("/api/profiles/me").json()["id"], bob["id"])
            self.assertEqual(other.get("/api/profiles/me").json()["sections"]["favorites"], [])
            self.assertEqual(other.get(f"/api/profiles/{alice['id']}").json()["sections"], {})
            self.assertEqual(self.client.get("/api/profiles/not-found").status_code, 404)
            with self.db.engine.begin() as conn:
                conn.execute(update(s.users).where(s.users.c.id == alice["id"]).values(disabled=True))
            self.assertEqual(other.get(f"/api/profiles/{alice['id']}").status_code, 404)
        finally:
            other.close()

    def test_profile_badges_follow_assigned_admin_premium_and_custom_roles(self):
        user = self.owner()
        with self.db.engine.begin() as conn:
            conn.execute(insert(s.roles), [{"id": "unique", "name": "Звездочёт", "protected": False}])
            conn.execute(insert(s.user_roles), [{"user_id": user["id"], "role_id": "premium"}, {"user_id": user["id"], "role_id": "unique"}])
        badges = self.client.get("/api/profiles/me").json()["badges"]
        self.assertEqual({badge["kind"] for badge in badges}, {"admin", "premium", "unique"})
        self.assertEqual(next(badge["name"] for badge in badges if badge["kind"] == "unique"), "Звездочёт")

    def test_member_can_use_all_presets_but_cannot_upload_search_or_spoof_presets(self):
        user = self.register()
        options = self.client.get("/api/profiles/media-options").json()
        self.assertFalse(options["canCustomize"])
        self.assertTrue(any(preset["animated"] for preset in options["presets"]))
        for preset in options["presets"]:
            response = self.mutate(self.client, "/api/auth/profile", {preset["kind"]: preset["url"]}, method="PATCH")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.client.get(f"/api/profiles/{user['id']}").json()[preset["kind"]], preset["url"])
        for value in ["https://images.example.test/static.png", "https://media.giphy.com/media/test/giphy.gif",
                      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "giphy:abc123"]:
            for field in ["avatar", "banner"]:
                with self.subTest(field=field, value=value[:50]):
                    self.assertEqual(self.mutate(self.client, "/api/auth/profile", {field: value, "username": "forbidden"}, method="PATCH").status_code, 403)
        self.assertEqual(self.client.get("/api/profiles/me").json()["username"], "alice")
        for value in ["/profile-presets/fake.svg", "/profile-presets/avatar-moon.svg?custom=1", "giphy:../evil"]:
            self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"avatar": value}, method="PATCH").status_code, 422)
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"avatar": "/profile-presets/banner-night.svg"}, method="PATCH").status_code, 422)
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"avatar": "", "banner": ""}, method="PATCH").status_code, 200)

    def test_custom_media_requires_current_permission_and_survives_unrelated_edits(self):
        user = self.register()
        with self.db.engine.begin() as conn:
            conn.execute(insert(s.user_roles).values(user_id=user["id"], role_id="premium"))
        self.assertTrue(self.client.get("/api/profiles/media-options").json()["canCustomize"])
        gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
        response = self.mutate(self.client, "/api/auth/profile", {"avatar": gif, "banner": "giphy:abc123"}, method="PATCH")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get(f"/api/profiles/{user['id']}").json()["banner"], "giphy:abc123")
        with self.db.engine.begin() as conn:
            conn.execute(s.user_roles.delete().where(s.user_roles.c.user_id == user["id"]))
        self.assertFalse(self.client.get("/api/profiles/media-options").json()["canCustomize"])
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"banner": "giphy:newGif"}, method="PATCH").status_code, 403)
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"about": "New text"}, method="PATCH").status_code, 200)
        self.assertEqual(self.client.get("/api/profiles/me").json()["avatar"], gif)

    def test_owner_has_custom_media_access_without_premium_badge(self):
        self.owner()
        self.assertTrue(self.client.get("/api/profiles/media-options").json()["canCustomize"])
        self.assertEqual(self.mutate(self.client, "/api/auth/profile", {"banner": "https://images.example.test/static.png"}, method="PATCH").status_code, 200)
        guest = self.new_client()
        try:
            self.assertEqual(guest.get("/api/profiles/media-options").status_code, 401)
        finally:
            guest.close()

    def test_passwords_sessions_and_one_time_verification(self):
        user = self.register(verified=False)
        self.assertFalse(user["emailVerified"])
        raw_session = self.client.cookies.get("animesoul_session_dev")
        with self.db.engine.connect() as conn:
            stored = conn.execute(select(s.users)).mappings().one()
            self.assertNotIn(PASSWORD, stored["password_hash"])
            self.assertTrue(stored["password_hash"].startswith("$argon2id$"))
            session = conn.execute(select(s.sessions)).mappings().one()
            self.assertNotEqual(session["token_hash"], raw_session)
        token = self.mail[-1][1]
        self.assertEqual(self.mutate(self.client, "/api/auth/confirm", {"token": token}).status_code, 200)
        self.assertNotEqual(raw_session, self.client.cookies.get("animesoul_session_dev"))
        self.assertEqual(self.mutate(self.client, "/api/auth/confirm", {"token": token}).status_code, 400)

    def test_csrf_origin_host_and_account_switch_boundaries(self):
        self.register()
        for headers in [{"Origin": "https://evil.test"}, {"X-CSRF-Token": "wrong"}, {"X-Account-Id": "another-user"}]:
            response = self.mutate(self.client, "/api/auth/profile", {"username": "changed"}, method="PATCH", headers=headers)
            self.assertIn(response.status_code, {403, 409})
        self.assertEqual(self.client.get("/api/auth/me", headers={"Host": "evil.test"}).status_code, 400)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["username"], "alice")

    def test_user_saves_are_relational_isolated_and_conflict_checked(self):
        alice = self.register()
        other = self.new_client()
        try:
            bob = self.register(other, "bob", "bob@example.test")
            first = self.client.get("/api/storage").json()
            old = deepcopy(first)
            snapshot = first["profiles"][0]["snapshot"]
            snapshot.update(favorites=[101, 102], folders=[{"id": "f", "name": "Watch", "animeIds": [101]}], progress={"101": {"episode": "3"}}, ratings={"101": {"anime": 9}}, tracked=[{"animeId": 101}], extra={"newer": True})
            response = self.mutate(self.client, "/api/storage", first, method="PUT")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["serverRevision"], 1)
            saved = self.client.get("/api/storage").json()
            self.assertEqual(saved["profiles"][0]["snapshot"], snapshot)
            self.assertEqual(self.mutate(self.client, "/api/storage", old, method="PUT").status_code, 409)
            self.assertEqual(other.get("/api/storage").json()["profiles"][0]["snapshot"], {})
            with self.db.engine.connect() as conn:
                items = conn.execute(select(s.save_items).where(s.save_items.c.user_id == alice["id"])).mappings().all()
                self.assertEqual(len(items), 6)
                self.assertFalse(conn.execute(select(s.save_items).where(s.save_items.c.user_id == bob["id"])).first())
            malformed = deepcopy(saved)
            malformed["profiles"].append(deepcopy(malformed["profiles"][0]))
            self.assertEqual(self.mutate(self.client, "/api/storage", malformed, method="PUT").status_code, 422)
            self.assertEqual(self.client.get("/api/storage").json(), saved)
        finally:
            other.close()

    def test_owner_requires_mailbox_proof_and_only_bootstraps_once(self):
        user = self.register(username="dogem", email="dogemmoze@gmail.com", verified=False)
        self.assertEqual(user["permissions"], [])
        self.assertEqual(self.client.get("/api/admin/users").status_code, 403)
        token = self.mail[-1][1]
        self.assertEqual(self.mutate(self.client, "/api/auth/confirm", {"token": token}).status_code, 200)
        user = self.client.get("/api/auth/me").json()["user"]
        self.assertEqual(user["roles"][0]["id"], "owner")
        self.assertEqual(self.mutate(self.client, f"/api/admin/users/{user['id']}/roles", {"roles": []}, method="PUT").status_code, 403)

    def test_player_permissions_enforced_on_server_and_revoked_immediately(self):
        owner = self.owner()
        member = self.new_client()
        try:
            user = self.register(member, "member", "member@example.test")
            self.assertEqual(self.mutate(member, "/api/kodik/stream").status_code, 403)
            url = f"/api/admin/users/{user['id']}/roles"
            self.assertEqual(self.mutate(self.client, url, {"roles": ["player"]}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/stream").status_code, 200)
            self.assertEqual(self.mutate(member, f"/api/admin/users/{owner['id']}/roles", {"roles": ["owner"]}, method="PUT").status_code, 403)
            self.assertEqual(self.mutate(self.client, url, {"roles": []}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/stream").status_code, 403)
        finally:
            member.close()

    def test_guest_catalog_is_public_but_account_and_premium_apis_are_protected(self):
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.client.get("/api/yummy").status_code, 200)
        self.assertEqual(self.client.get("/api/storage").status_code, 401)
        self.assertEqual(self.mutate(self.client, "/api/kodik/stream").status_code, 401)
        self.assertEqual(self.mutate(self.client, "/api/kodik/download").status_code, 401)
        self.assertEqual(self.client.get("/api/admin/users").status_code, 401)

    def test_download_access_is_independent_verified_and_revoked_on_server(self):
        self.owner()
        member = self.new_client()
        try:
            user = self.register(member, "downloadmember", "downloads@example.test", verified=False)
            target = f"/api/admin/users/{user['id']}/roles"
            self.assertEqual(self.mutate(self.client, target, {"roles": ["downloads"]}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/download").status_code, 403)
            token = next(token for email, token, purpose in reversed(self.mail) if email == user["email"] and purpose == "verify")
            self.assertEqual(self.mutate(member, "/api/auth/confirm", {"token": token}).status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/download").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/stream").status_code, 403)
            self.assertEqual(self.mutate(self.client, target, {"roles": ["player"]}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/stream").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/download").status_code, 403)
            self.assertEqual(self.mutate(self.client, target, {"roles": ["player", "downloads"]}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/download").status_code, 200)
            self.assertEqual(self.mutate(self.client, target, {"roles": []}, method="PUT").status_code, 200)
            self.assertEqual(self.mutate(member, "/api/kodik/download").status_code, 403)
        finally:
            member.close()

    def test_roles_and_admin_audit(self):
        self.owner()
        result = self.mutate(self.client, "/api/admin/roles", {"name": "Test team", "permissions": ["player.use"]})
        self.assertEqual(result.status_code, 200, result.text)
        role_id = result.json()["id"]
        self.assertEqual(self.mutate(self.client, f"/api/admin/roles/{role_id}", {"name": "QA", "permissions": []}, method="PUT").status_code, 200)
        self.assertEqual(self.mutate(self.client, "/api/admin/roles/owner", {"name": "Hijacked", "permissions": []}, method="PUT").status_code, 403)
        self.assertEqual(self.mutate(self.client, "/api/admin/roles", {"name": "Invalid", "permissions": ["root"]}).status_code, 422)
        events = self.client.get("/api/admin/audit").json()["events"]
        self.assertTrue(any(e["action"] == "role.update" for e in events))

    def test_password_change_revokes_other_sessions_and_requires_old_password(self):
        self.register()
        other = self.new_client()
        try:
            self.assertEqual(self.mutate(other, "/api/auth/login", {"login": "alice", "password": PASSWORD}).status_code, 200)
            data = {"password": "replacement-password-456", "currentPassword": "incorrect"}
            self.assertEqual(self.mutate(self.client, "/api/auth/password", data).status_code, 403)
            data["currentPassword"] = PASSWORD
            self.assertEqual(self.mutate(self.client, "/api/auth/password", data).status_code, 200)
            self.assertIsNone(other.get("/api/auth/me").json()["user"])
            self.assertEqual(self.mutate(other, "/api/auth/login", {"login": "alice", "password": PASSWORD}).status_code, 401)
        finally:
            other.close()

    def test_email_change_is_pending_until_verified_and_revokes_sessions(self):
        self.register()
        data = {"email": "new@example.test", "currentPassword": PASSWORD}
        self.assertEqual(self.mutate(self.client, "/api/auth/email", data).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["email"], "alice@example.test")
        token = self.mail[-1][1]
        self.assertEqual(self.mutate(self.client, "/api/auth/confirm", {"token": token}).status_code, 200)
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.mutate(self.client, "/api/auth/login", {"login": "new@example.test", "password": PASSWORD}).status_code, 200)

    def test_reset_generic_response_and_token_changes_password(self):
        self.register()
        other = self.new_client()
        try:
            existing = self.mutate(other, "/api/auth/reset", {"email": "alice@example.test"})
            missing = self.mutate(other, "/api/auth/reset", {"email": "missing@example.test"})
            self.assertEqual(existing.json(), missing.json())
            token = self.mail[-1][1]
            self.assertEqual(self.mutate(other, "/api/auth/confirm", {"token": token, "password": "reset-password-456"}).status_code, 200)
            self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
            self.assertEqual(self.mutate(other, "/api/auth/confirm", {"token": token, "password": "reset-password-456"}).status_code, 400)
        finally:
            other.close()

    def test_local_routes_and_large_bodies_are_blocked(self):
        for path in ["/api/storage", "/api/admin/users", "/api/kodik/stream"]:
            response = self.client.get(path) if path != "/api/kodik/stream" else self.mutate(self.client, path)
            self.assertIn(response.status_code, {401, 403})
        for path in ["/api/downloads/settings", "/api/gdrive/status", "/api/lan/status", "/api/yummy/credentials", "/watch-party/state"]:
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(self.mutate(self.client, "/api/auth/login", {"login": "a" * (4 * 1024 * 1024), "password": "x"}).status_code, 413)
        response = self.client.get("/api/auth/config")
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])

    def test_login_rate_limit_persists_across_clients(self):
        other = self.new_client()
        try:
            for _ in range(10):
                self.assertEqual(self.mutate(self.client, "/api/auth/login", {"login": "missing", "password": PASSWORD}).status_code, 401)
            self.assertEqual(self.mutate(other, "/api/auth/login", {"login": "missing", "password": PASSWORD}).status_code, 429)
        finally:
            other.close()

    def test_oauth_state_is_browser_bound_one_time_and_uses_pkce(self):
        response = self.client.get("/api/auth/google/start", follow_redirects=False)
        query = parse_qs(urlsplit(response.headers["location"]).query)
        self.assertEqual(query["scope"], ["openid email profile"])
        self.assertEqual(query["code_challenge_method"], ["S256"])
        state = query["state"][0]
        stranger = self.new_client()
        try:
            response = stranger.get(f"/api/auth/google/callback?state={state}&code=fake", follow_redirects=False)
            self.assertIn("auth_error", response.headers["location"])
            with self.db.engine.connect() as conn:
                self.assertTrue(conn.execute(select(s.oauth_states).where(s.oauth_states.c.state_hash == digest(state))).first())
            # A denied callback consumes the correctly bound state.
            self.client.get(f"/api/auth/google/callback?state={state}&error=access_denied", follow_redirects=False)
            with self.db.engine.connect() as conn:
                self.assertFalse(conn.execute(select(s.oauth_states)).first())
        finally:
            stranger.close()

    def test_expired_sessions_are_not_accepted(self):
        self.register()
        raw = self.client.cookies.get("animesoul_session_dev")
        from sqlalchemy import update
        with self.db.engine.begin() as conn:
            conn.execute(update(s.sessions).where(s.sessions.c.token_hash == digest(raw)).values(expires_at=now() - 1))
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])

    def google_callback(self, claims, client=None):
        client = client or self.client
        start = client.get("/api/auth/google/start", follow_redirects=False)
        query = parse_qs(urlsplit(start.headers["location"]).query)
        state = query["state"][0]
        claims = {"sub": "google-user-123", "email": "google@example.test", "email_verified": True, "nonce": query["nonce"][0], **claims}
        class TokenResponse:
            def raise_for_status(self):
                pass
            def json(self):
                return {"id_token": "test-id-token"}
        class TokenClient:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *_args):
                pass
            async def post(self, url, data):
                self.test_data = data
                return TokenResponse()
        token_client = TokenClient()
        with patch("backend.app.website.google.httpx.AsyncClient", return_value=token_client), patch("backend.app.website.google.verify_oauth2_token", return_value=claims) as verifier:
            response = client.get(f"/api/auth/google/callback?state={state}&code=test-code", follow_redirects=False)
            self.assertEqual(verifier.call_args.args[2], "test-client")
            self.assertIn("code_verifier", token_client.test_data)
        return response, state

    def test_google_login_identity_survives_email_changes_and_can_add_password(self):
        response, state = self.google_callback({"email": "dogemmoze@gmail.com"})
        self.assertNotIn("auth_error", response.headers["location"])
        user = self.client.get("/api/auth/me").json()["user"]
        self.assertTrue(user["googleLinked"])
        self.assertFalse(user["hasPassword"])
        self.assertTrue(any(role["id"] == "owner" for role in user["roles"]))
        self.assertEqual(self.mutate(self.client, "/api/auth/password", {"password": PASSWORD}).status_code, 200)
        second = self.new_client()
        try:
            response, _ = self.google_callback({"email": "changed-at-google@example.test"}, second)
            self.assertNotIn("auth_error", response.headers["location"])
            self.assertEqual(second.get("/api/auth/me").json()["user"]["id"], user["id"])
        finally:
            second.close()
        self.assertIn("auth_error", self.client.get(f"/api/auth/google/callback?state={state}&code=replay", follow_redirects=False).headers["location"])

    def test_google_rejects_nonce_mismatch_unverified_mail_and_implicit_linking(self):
        for claims in [{"nonce": "wrong"}, {"email_verified": False}, {"azp": "wrong-client"}]:
            response, _ = self.google_callback(claims)
            self.assertIn("auth_error", response.headers["location"])
            self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.register(email="google@example.test")
        stranger = self.new_client()
        try:
            response, _ = self.google_callback({}, stranger)
            self.assertIn("auth_error", response.headers["location"])
            self.assertIsNone(stranger.get("/api/auth/me").json()["user"])
        finally:
            stranger.close()

    def test_google_only_old_session_must_reauthenticate_before_credential_change(self):
        self.google_callback({})
        raw = self.client.cookies.get("animesoul_session_dev")
        from sqlalchemy import update
        with self.db.engine.begin() as conn:
            conn.execute(update(s.sessions).where(s.sessions.c.token_hash == digest(raw)).values(created_at=now() - 301))
        self.assertEqual(self.mutate(self.client, "/api/auth/password", {"password": PASSWORD}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
