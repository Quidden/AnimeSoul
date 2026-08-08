# AnimeSoul Google Drive Cloud Synchronization

This document outlines the technical architecture, data model, OAuth authorization flow, conflict resolution strategy, and API endpoints for the Google Drive cloud sync integration in **AnimeSoul**.

---

## 1. Overview

The Google Drive synchronization engine enables multi-device profile and progress synchronization without requiring a dedicated backend server or external database. All user data is encrypted in transit and stored inside a dedicated app folder (`AnimeSoul/animesoul-storage.json`) on the user's personal Google Drive.

```
+-------------------+        OAuth 2.0 PKCE       +-----------------------+
|  AnimeSoul App    | <=========================> |  Google Auth Server   |
| (Frontend/Local)  |                             +-----------------------+
+-------------------+                                         |
          |                                                   v
          |               REST API (JSON)         +-----------------------+
          +-------------------------------------> |   Google Drive API    |
                                                  | (AnimeSoul/storage)   |
                                                  +-----------------------+
```

---

## 2. Authentication Flow

AnimeSoul utilizes standard **OAuth 2.0 PKCE** flow for desktop application authentication.

1. **Authorization Request**:
   - GET `/api/gdrive/auth-url` returns a Google OAuth authorization URL requesting scope `https://www.googleapis.com/auth/drive.file`.
2. **Code Exchange**:
   - POST `/api/gdrive/callback` receives the authorization code, exchanges it for `access_token` and `refresh_token`, and stores tokens locally in `data/gdrive-tokens.json`.
3. **First-Time Detection & Choice Pending**:
   - During code exchange, the backend checks if `animesoul-storage.json` already exists in Google Drive.
   - If a cloud file exists, the system sets `choice_pending: true`. This prevents automatic background overwrites until the user explicitly chooses a synchronization preference.

---

## 3. Data Model Schema

The cloud storage file (`animesoul-storage.json`) follows schema version 1:

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "id": "default",
      "name": "Default Profile",
      "snapshot": {
        "favorites": ["anime_id_1", "anime_id_2"],
        "folders": [
          {
            "id": "folder_1",
            "name": "Plan to Watch",
            "animeIds": ["anime_id_3"]
          }
        ],
        "tracked": [
          {
            "animeId": "anime_id_1",
            "targetEpisode": 12,
            "status": "watching"
          }
        ],
        "progress": {
          "anime_id_1": {
            "lastEpisode": 5,
            "episodes": {
              "1": { "watched": true, "timestamp": 1240 },
              "2": { "watched": true, "timestamp": 1420 }
            }
          }
        },
        "playerPrefs": {
          "volume": 0.8,
          "autoPlayNext": true,
          "theme": "dark"
        },
        "theme": {
          "primaryColor": "#7c3aed",
          "accentColor": "#a78bfa"
        }
      }
    }
  ]
}
```

---

## 4. Synchronization Modes & Resolution Rules

AnimeSoul supports **5 distinct synchronization modes**:

| Mode | Identifier | Description & Resolution Logic |
| :--- | :--- | :--- |
| **Smart Merge** | `merge` | **(Default / Recommended)** Merges anime progress and settings. Watched episode states take priority. Preserves data from both devices. |
| **Anime Only** | `anime_only` | Merges anime progress, favorites, folders, and watched episodes while keeping local UI themes, player preferences, and colors 100% untouched. |
| **Cloud Priority** | `cloud` | Overwrites local PC settings and progress entirely with the file from Google Drive (`Cloud -> PC`). |
| **Local Priority** | `local` | Overwrites Google Drive backup completely with current PC data (`PC -> Cloud`). |
| **Automatic Background** | `auto` | Triggered periodically or on file save. Executes `merge` logic only when `choice_pending` is `false`. |

### Merge Conflict Strategy:
- **Watched Episode Rules**: If an episode is marked as `watched` on either device, it remains marked as `watched`. Higher episode numbers and larger watch timestamps are preferred.
- **Lists & Favorites**: Unique items across local and cloud collections are combined (set union).
- **Settings & Themes**: In `merge` mode, local settings take precedence for identical keys unless empty. In `anime_only` mode, local settings are strictly preserved.

---

## 5. API Endpoints Reference

### `GET /api/gdrive/auth-url`
Retrieves Google OAuth 2.0 authorization URL.
- **Response**: `{ "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }`

### `POST /api/gdrive/callback`
Exchanges OAuth authorization code for access and refresh tokens.
- **Body**: `{ "code": "<authorization_code>" }`
- **Response**: `{ "status": "authenticated", "choice_pending": true }`

### `GET /api/gdrive/status`
Checks current authentication and sync status.
- **Response**:
  ```json
  {
    "connected": true,
    "email": "user@gmail.com",
    "choice_pending": false,
    "has_cloud_file": true,
    "last_sync": "2026-08-02T02:35:00Z"
  }
  ```

### `POST /api/gdrive/sync`
Executes synchronization with chosen mode.
- **Body**: `{ "mode": "merge" | "anime_only" | "cloud" | "local" | "auto" }`
- **Response**: `{ "status": "success", "synced_at": "ISO-8601 Timestamp" }`

### `POST /api/gdrive/disconnect`
Revokes Google tokens and removes local authentication credentials.
- **Response**: `{ "status": "disconnected" }`

---

## 6. Frontend UI Indicator & Choice Guard

When `choice_pending` is active:
1. Header status indicator displays **`Облако · Требуется выбор`** in **RED**.
2. Automatic background sync is suspended until the user explicitly selects a mode.
3. Clicking the indicator opens the modal with 4 styled options and hover feedback.
