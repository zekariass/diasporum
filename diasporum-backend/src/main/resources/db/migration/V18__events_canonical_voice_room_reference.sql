-- Removes the redundant events.voice_room_id added by V5. The canonical
-- Voice Rooms boundary already exists in the v10.12 baseline as
-- events.linked_voice_room_id uuid REFERENCES voice_rooms(id) with a CHECK
-- (ONLINE_VOICE requires the reference, other modes must not set it) and the
-- events_no_past_voice_room_link trigger. The V5 column has no FK, is never
-- written (ONLINE_VOICE creation is application-rejected) and duplicates the
-- approved boundary, so it is dropped rather than kept alongside.
ALTER TABLE events DROP COLUMN IF EXISTS voice_room_id;
