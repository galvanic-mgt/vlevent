# Security hardening notes

This project is currently a browser-only static app that talks directly to Firebase Realtime Database through unauthenticated REST calls.

## Current risk

- `src/fb.js` sends `GET`, `PUT`, `PATCH`, and `DELETE` requests without Firebase Auth.
- `src/ui_cms_firebase.js` stores CMS users under `/users` and compares plain-text passwords in the browser.
- Admin pages such as `index.html`, `pre_event_admin.html`, and `pre_attendance_export.html` can read or write event data if the Firebase Realtime Database rules allow public access.
- Event links contain the event id, and many pages use that id to read `/events/{eventId}/people`, which includes names, phone numbers, departments, attendance, table, seat, prizes, and pre-event choices.

## Recommended secure design

1. Enable Firebase Authentication for administrators.
2. Replace the custom `/users` password system with Firebase Auth users plus role data stored under `/roles/{uid}`.
3. Lock Realtime Database rules so admin writes require an authenticated user.
4. Keep public pages on narrow, purpose-specific paths. Do not expose the full `people` roster to public pages.
5. Move sensitive lookups, such as check-in by phone number, behind a Cloud Function so the browser never downloads the full roster.
6. Remove or rotate the default `administrator / administrator` account immediately.

## Example Realtime Database rules

These rules are a starting point and will break the current app until Firebase Auth and narrower public read/write paths are implemented.

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "roles": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    },

    "events_index": {
      ".read": "auth != null && root.child('roles').child(auth.uid).child('role').val() === 'master'",
      ".write": "auth != null && root.child('roles').child(auth.uid).child('role').val() === 'master'"
    },

    "events": {
      "$eventId": {
        "meta": {
          ".read": true,
          ".write": "auth != null"
        },
        "info": {
          ".read": true,
          ".write": "auth != null"
        },
        "logo": {
          ".read": true,
          ".write": "auth != null"
        },
        "banner": {
          ".read": true,
          ".write": "auth != null"
        },
        "background": {
          ".read": true,
          ".write": "auth != null"
        },
        "photos": {
          ".read": true,
          ".write": "auth != null"
        },

        "people": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "preEventApplications": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "preAttendance": {
          ".read": "auth != null",
          ".write": true
        },
        "prizes": {
          ".read": true,
          ".write": "auth != null"
        },
        "polls": {
          ".read": true,
          ".write": "auth != null"
        },
        "ui": {
          ".read": true,
          ".write": "auth != null"
        }
      }
    },

    "users": {
      ".read": false,
      ".write": false
    }
  }
}
```

## Safer public data model

Instead of public pages reading `/events/{eventId}/people`, create public-only data:

```json
{
  "publicEvents": {
    "EVENT_ID": {
      "info": {},
      "assets": {},
      "currentPrizeId": "",
      "winnerNames": {},
      "polls": {}
    }
  }
}
```

Admin code can write a sanitized copy there, while private roster data stays under `/events/{eventId}/people`.

