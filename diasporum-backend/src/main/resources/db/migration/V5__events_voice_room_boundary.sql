-- Events × Voice Rooms integration boundary (forward-only, events milestone).
-- v10.12 defines three event modes: IN_PERSON, ONLINE_EXTERNAL, ONLINE_VOICE.
-- ONLINE_VOICE requires the Voice Rooms milestone (LiveKit) which is not
-- implemented yet, so creating ONLINE_VOICE events is still rejected by the
-- application layer. This migration prepares the persistence boundary only:
-- an event references a *Diasporum* voice room by platform-owned ID. Provider
-- credentials, room URLs and tokens are never stored on events — the voice
-- rooms module owns all LiveKit specifics and mints short-lived join grants.
-- No FK is declared because the voice rooms table does not exist yet; it will
-- be added with the Voice Rooms milestone.
ALTER TABLE events ADD COLUMN voice_room_id uuid;
COMMENT ON COLUMN events.voice_room_id IS
    'Reference to a future Diasporum voice room for ONLINE_VOICE events; platform-owned ID only, never provider credentials.';
