[English](LAN_DEVICES.md) | [Русский](LAN_DEVICES.ru.md)

# Local network devices

Settings → **Устройства** enables optional paired Windows/Android exchange without
internet access. Both applications must remain open and reachable. The feature is
disabled by default; remote player control requires a separate per-device grant.

Enable exchange on both devices. Show the four-digit code on one, then enter its
IPv4 address and code on the other. Codes expire after five minutes, are single-use,
and allow at most five incorrect attempts. Both screens show the connection status.
Devices retain a UUID and a random long-term pairing key in
`animesoul-devices.json`. Update the saved address after a DHCP change; automatic
address discovery is not implemented. TCP port **48765** must be reachable.

Save synchronization is automatic (roughly ten-second polling cycles). Profiles
match by ID, including the shared `default` profile. Different profile IDs remain
separate. Anime data uses the existing Drive merge rules, per-field/per-episode
revisions and reset markers. Device settings and credentials are excluded. Merged
data enters normal UI autosave and the existing Google Drive queue, respecting
the initial cloud-sync choice. The latest on-disk revision is included, and UI
edits made while awaiting a merge invalidate that response.

To receive episodes, open a peer's **Скачанные серии и пульт**, load its downloaded library,
select episodes and choose **Получить выбранные**. This works in either direction.
MP4, artwork and original episode metadata are streamed and checked against a
signed size/SHA-256 manifest before indexing. Android uses normal MediaStore
publication. Failed partial files are not indexed; retry restarts the file.
Legacy HLS packages, transfer persistence across restarts, IPv6 and Android
background operation are not supported in this version.

The remote supports play/pause, seeking, episode/season/dubbing selection, adjacent
episodes and opening titles by catalog ID or from the target's downloads. Online
titles still require the target's normal internet/source access. Local-priority
mode blocks remote commands for ten seconds after local input. Controllers have
a fifteen-second lease; a higher configured priority may preempt it. Commands
expire and are deduplicated and acknowledged by the target UI. External Kodik
iframes can acknowledge dispatch only; browser autoplay restrictions still apply.

LAN uses a separate limited HTTP application, never the full storage/settings API.
Administration requires loopback and acceptable Host/Origin. HMAC-SHA256 requests
bind method, path, device ID, a single-use server challenge and body; JSON responses
are signed and media is verified against the signed manifest. The four-digit code
is temporary and devices retain a separate random key. HTTP content is **not
encrypted**: use a trusted LAN.

Implementation: `backend/app/api/lan.py`, `backend/app/services/lan*.py`, and
`frontend/src/features/devices/`. Tests in `backend/tests/test_lan.py` cover pairing,
replay/revocation, access controls, priorities, save convergence and MP4 import.
Android publication uses a mocked native bridge in these tests; end-to-end testing
on a physical Windows/Android pair remains necessary.

[Detailed Russian guide](LAN_DEVICES.ru.md)
