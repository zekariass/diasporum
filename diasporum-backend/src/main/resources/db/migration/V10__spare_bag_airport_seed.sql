-- Initial Spare Bag airport catalogue for the approved Ethiopian diaspora corridors.
-- Countries are normally installed by ReferenceDataSeeder, but Flyway runs first on
-- a fresh database. Ensure only the seven required approved country rows exist.
INSERT INTO countries(name,iso2,iso3,demonym) VALUES
 ('Ethiopia','ET','ETH','Ethiopian'),
 ('United Kingdom','GB','GBR','British'),
 ('United States','US','USA','American'),
 ('Germany','DE','DEU','German'),
 ('Canada','CA','CAN','Canadian'),
 ('Australia','AU','AUS','Australian'),
 ('Sweden','SE','SWE','Swedish')
ON CONFLICT(iso2) DO NOTHING;

WITH approved(iata_code,icao_code,name,city,iso2) AS (
    VALUES
     ('ADD','HAAB','Addis Ababa Bole International Airport','Addis Ababa','ET'),
     ('LHR','EGLL','London Heathrow Airport','London','GB'),
     ('IAD','KIAD','Washington Dulles International Airport','Dulles','US'),
     ('FRA','EDDF','Frankfurt Airport','Frankfurt','DE'),
     ('YYZ','CYYZ','Toronto Pearson International Airport','Toronto','CA'),
     ('SYD','YSSY','Sydney Kingsford Smith Airport','Sydney','AU'),
     ('ARN','ESSA','Stockholm Arlanda Airport','Stockholm','SE')
)
INSERT INTO airports(country_id,iata_code,icao_code,name,city)
SELECT c.id,a.iata_code,a.icao_code,a.name,a.city
FROM approved a JOIN countries c ON c.iso2=a.iso2
ON CONFLICT(iata_code) DO UPDATE SET
    country_id=EXCLUDED.country_id,
    icao_code=EXCLUDED.icao_code,
    name=EXCLUDED.name,
    city=EXCLUDED.city,
    updated_at=now();

-- Keep every existing media purpose while enabling Property and Spare Bag uploads.
ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check
    CHECK (purpose IN (
        'AVATAR','FEED_IMAGE','FEED_VIDEO','BUSINESS','EVENT','JOB','PROPERTY',
        'MATCHMAKING_PROFILE_PHOTO','MATCHMAKING_PROFILE_BLURRED','CHAT_ATTACHMENT',
        'SPARE_BAG_LISTING','DOCUMENT','OTHER','MESSAGE_AUDIO',
        'MESSAGE_IMAGE','MESSAGE_DOCUMENT'
    ));
