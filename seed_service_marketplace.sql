-- ============================================================================
-- Diasporum — Service Marketplace demo seed (v10_12 / v10.14 schema)
-- ----------------------------------------------------------------------------
-- Populates a realistic service marketplace for local development:
--   * 10 demo accounts (4 customers, 6 provider owners) across six cities
--   * 6 verified, APPROVED personal providers linked to child categories
--   * 12 service requests (OPEN / DRAFT / CLOSED) with budgets and locations
--   * provider responses (INTEREST + QUOTE), structured quotes (SENT +
--     ACCEPTED), completed engagements, lead access with chat enabled, and
--     published reviews
--
-- Requires seed_reference_data.sql (countries, languages, service categories)
-- to have been applied first. All inserts are idempotent via fixed UUIDs +
-- ON CONFLICT DO NOTHING, so the script can be re-run safely.
--
-- Category card imagery is rendered client-side: the mobile app maps each
-- category_key to a public photo in
--   diasporum-mobile/src/features/services/utils/category-visuals.ts
-- (service_category_media/media_objects require real uploaded binaries in R2
-- and are not suitable for URL-based seed data).
--
-- Demo accounts cannot sign in (no credentials/Keycloak identity) — they exist
-- so marketplace browse/discovery screens show believable content.
--
-- Run (from workspace root):
--   docker exec -i diasporum-postgres psql -U diasporum -d diasporum_dev_v10_12 \
--       -f - < seed_reference_data.sql
--   docker exec -i diasporum-postgres psql -U diasporum -d diasporum_dev_v10_12 \
--       -f - < seed_service_marketplace.sql
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Demo accounts: users + profiles share the same id
-- --------------------------------------------------------------------------
INSERT INTO users(id,email,email_verified_at,account_status)
VALUES
    ('d0000000-0000-4000-8000-0000000000c1','sarah.mensah@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-0000000000c2','daniel.kim@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-0000000000c3','fatima.alsayed@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-0000000000c4','miguel.santos@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000011','amara.tesfaye@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000012','chidinma.okafor@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000013','wanjiru.njoroge@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000014','nadia.asante@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000015','omar.haddad@demo.diasporum.local',now(),'ACTIVE'),
    ('d0000000-0000-4000-8000-000000000016','priya.sharma@demo.diasporum.local',now(),'ACTIVE')
ON CONFLICT(id) DO NOTHING;

INSERT INTO profiles(id,username,display_name,bio,origin_country_id,current_country_id,city,profile_completed_at)
SELECT v.id,v.username,v.display_name,v.bio,o.id,c.id,v.city,now()
FROM (VALUES
    -- customers
    ('d0000000-0000-4000-8000-0000000000c1'::uuid,'sarah.mensah','Sarah Mensah','Ghanaian nurse settling in London.','GH','GB','London'),
    ('d0000000-0000-4000-8000-0000000000c2'::uuid,'daniel.kim','Daniel Kim','Software analyst in New York.','KR','US','New York'),
    ('d0000000-0000-4000-8000-0000000000c3'::uuid,'fatima.alsayed','Fatima Al-Sayed','Syrian mother of two in Berlin.','SY','DE','Berlin'),
    ('d0000000-0000-4000-8000-0000000000c4'::uuid,'miguel.santos','Miguel Santos','Brazilian chef in Toronto.','BR','CA','Toronto'),
    -- provider owners
    ('d0000000-0000-4000-8000-000000000011'::uuid,'amara.tesfaye','Amara Tesfaye','Ethiopian tradeswoman — plumbing and electrical repairs.','ET','GB','London'),
    ('d0000000-0000-4000-8000-000000000012'::uuid,'chidinma.okafor','Chidinma Okafor','Nigerian cleaning professional serving East London.','NG','GB','London'),
    ('d0000000-0000-4000-8000-000000000013'::uuid,'wanjiru.njoroge','Wanjiru Njoroge','Kenyan gardener and landscaper in Toronto.','KE','CA','Toronto'),
    ('d0000000-0000-4000-8000-000000000014'::uuid,'nadia.asante','Nadia Asante','Ghanaian hairstylist and braider in Brooklyn.','GH','US','New York'),
    ('d0000000-0000-4000-8000-000000000015'::uuid,'omar.haddad','Omar Haddad','Syrian driver with a Luton van across Berlin.','SY','DE','Berlin'),
    ('d0000000-0000-4000-8000-000000000016'::uuid,'priya.sharma','Priya Sharma','Indian web developer and designer in Dubai.','IN','AE','Dubai')
) AS v(id,username,display_name,bio,o2,d2,city)
JOIN countries o ON o.iso2=v.o2
JOIN countries c ON c.iso2=v.d2
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. Demo providers (ACTIVE + VERIFIED + onboarding APPROVED so they can
--    respond and quote; linked to child categories below)
-- --------------------------------------------------------------------------
INSERT INTO service_providers(id,owner_user_id,display_name,description,base_location,radius_km,status,verification_status,onboarding_status,onboarding_submitted_at,onboarding_reviewed_at)
SELECT v.id,p.id,v.display_name,v.description,ST_GeogFromText(v.point),v.radius,'ACTIVE','VERIFIED','APPROVED',now()-interval '30 days',now()-interval '30 days'
FROM (VALUES
    ('d1111111-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'Amara''s Home Repairs','Fast, tidy plumbing and electrical repairs across London. Same-day callouts available.','SRID=4326;POINT(-0.1276 51.5072)',40::numeric),
    ('d1111111-0000-4000-8000-000000000012'::uuid,'d0000000-0000-4000-8000-000000000012'::uuid,'Sparkle Clean Co.','Deep cleaning, end-of-tenancy and regular domestic cleaning in East London.','SRID=4326;POINT(-0.0595 51.5285)',30::numeric),
    ('d1111111-0000-4000-8000-000000000013'::uuid,'d0000000-0000-4000-8000-000000000013'::uuid,'Toronto Garden Works','Garden makeovers, seasonal tidy-ups and planting across the GTA.','SRID=4326;POINT(-79.3832 43.6532)',50::numeric),
    ('d1111111-0000-4000-8000-000000000014'::uuid,'d0000000-0000-4000-8000-000000000014'::uuid,'Nadia Hair & Beauty','Braids, weaves, natural hair and gel nails — home visits in Brooklyn and Queens.','SRID=4326;POINT(-73.9442 40.6782)',25::numeric),
    ('d1111111-0000-4000-8000-000000000015'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'Berlin Move & Deliver','Man-with-van moves, furniture pickups and courier work across Berlin.','SRID=4326;POINT(13.4050 52.5200)',60::numeric),
    ('d1111111-0000-4000-8000-000000000016'::uuid,'d0000000-0000-4000-8000-000000000016'::uuid,'Pixel & Code Studio','Websites, landing pages and branding for small businesses and restaurants.','SRID=4326;POINT(55.2708 25.2048)',150::numeric)
) AS v(id,owner,display_name,description,point,radius)
JOIN users p ON p.id=v.owner
ON CONFLICT(id) DO NOTHING;

INSERT INTO service_provider_services(service_provider_id,service_category_id)
SELECT v.provider_id,c.id
FROM (VALUES
    ('d1111111-0000-4000-8000-000000000011'::uuid,'PLUMBING'),
    ('d1111111-0000-4000-8000-000000000011'::uuid,'ELECTRICAL_WORK'),
    ('d1111111-0000-4000-8000-000000000011'::uuid,'HANDYMAN'),
    ('d1111111-0000-4000-8000-000000000012'::uuid,'HOUSE_CLEANING'),
    ('d1111111-0000-4000-8000-000000000012'::uuid,'WINDOW_CLEANING'),
    ('d1111111-0000-4000-8000-000000000013'::uuid,'GARDENING'),
    ('d1111111-0000-4000-8000-000000000013'::uuid,'PEST_CONTROL'),
    ('d1111111-0000-4000-8000-000000000014'::uuid,'HAIRDRESSING'),
    ('d1111111-0000-4000-8000-000000000014'::uuid,'BARBERING'),
    ('d1111111-0000-4000-8000-000000000014'::uuid,'NAILS_BEAUTY'),
    ('d1111111-0000-4000-8000-000000000015'::uuid,'REMOVALS_MOVING'),
    ('d1111111-0000-4000-8000-000000000015'::uuid,'VAN_MAN_HIRE'),
    ('d1111111-0000-4000-8000-000000000015'::uuid,'DELIVERY_COURIER'),
    ('d1111111-0000-4000-8000-000000000016'::uuid,'WEB_APP_DEVELOPMENT'),
    ('d1111111-0000-4000-8000-000000000016'::uuid,'GRAPHIC_DESIGN'),
    ('d1111111-0000-4000-8000-000000000016'::uuid,'DIGITAL_MARKETING')
) AS v(provider_id,category_key)
JOIN service_categories c ON c.category_key=v.category_key
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------
-- 3. Demo service requests (all posted OPEN except the draft; the three
--    completed jobs are flipped to CLOSED at the end once their engagement
--    exists)
-- --------------------------------------------------------------------------
INSERT INTO service_requests(id,customer_user_id,service_category_id,country_id,location,title,description,budget_min,budget_max,currency_code,preferred_date,status,expires_at,published_at,created_at)
SELECT v.id,p.id,c.id,co.id,ST_GeogFromText(v.point),v.title,v.description,v.bmin,v.bmax,v.ccy,v.pref,v.status,
       now()+v.exp_days*interval '1 day',
       now()-v.pub_days*interval '1 day',
       now()-v.pub_days*interval '1 day'
FROM (VALUES
    ('d2222222-0000-4000-8000-000000000021'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'PLUMBING','GB','SRID=4326;POINT(-0.0990 51.5155)','Leaking kitchen tap needs urgent fix','Cold-water tap in the kitchen is dripping constantly and the under-sink trap looks corroded. Need someone to replace the tap and check the waste pipe. Materials can be reimbursed with receipts.',60,120,'GBP',current_date+3,'OPEN',30,20),
    ('d2222222-0000-4000-8000-000000000022'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'HOUSE_CLEANING','GB','SRID=4326;POINT(-0.0540 51.5260)','End of tenancy deep clean — 2 bed flat','Moving out end of the month. Need a full deep clean to agency standard: oven, fridge, skirting boards, inside windows, bathrooms descaled. Inventory check follows, so references welcome.',150,220,'GBP',current_date+14,'OPEN',30,18),
    ('d2222222-0000-4000-8000-000000000023'::uuid,'d0000000-0000-4000-8000-0000000000c2'::uuid,'PHOTOGRAPHY','US','SRID=4326;POINT(-73.9857 40.7484)','Photographer for 50-person engagement party','Looking for an event photographer for a 4-hour engagement party at a restaurant in Midtown. Mix of candid and posed family shots. Deliverables: edited digital gallery within two weeks.',800,1500,'USD',current_date+21,'OPEN',45,4),
    ('d2222222-0000-4000-8000-000000000024'::uuid,'d0000000-0000-4000-8000-0000000000c2'::uuid,'ACADEMIC_TUTORING','US','SRID=4326;POINT(-73.9560 40.7120)','Maths tutor — GCSE-level algebra, twice weekly','My daughter is preparing for her GCSEs and struggling with algebra and quadratic equations. Looking for a patient tutor for two one-hour sessions a week, evenings, at our home in Brooklyn or online.',35,60,'USD',NULL,'OPEN',60,5),
    ('d2222222-0000-4000-8000-000000000025'::uuid,'d0000000-0000-4000-8000-0000000000c3'::uuid,'REMOVALS_MOVING','DE','SRID=4326;POINT(13.4240 52.4890)','Small flat move — Kreuzberg to Wedding','Moving a 1-bed flat: about 20 boxes, a sofa, bed frame and a desk. No white goods. Third floor with lift at pickup, second floor stairs at destination. Flexible on timing.',200,350,'EUR',current_date+10,'OPEN',30,6),
    ('d2222222-0000-4000-8000-000000000026'::uuid,'d0000000-0000-4000-8000-0000000000c3'::uuid,'LANGUAGE_TUTORING','DE','SRID=4326;POINT(13.4400 52.5250)','Amharic conversation lessons for two kids','Would love our children (6 and 9) to keep their Amharic. Looking for a native speaker for weekly fun, play-based sessions at our home in Prenzlauer Berg.',15,25,'EUR',NULL,'OPEN',60,7),
    ('d2222222-0000-4000-8000-000000000027'::uuid,'d0000000-0000-4000-8000-0000000000c4'::uuid,'GARDENING','CA','SRID=4326;POINT(-79.4200 43.6650)','Backyard garden cleanup and planting','Overgrown backyard needs weeding, hedge trimming, soil prep and planting of easy-care perennials. Roughly 40ft x 25ft. Green bin pickup available — quote for one full day or split across two.',250,400,'CAD',current_date+7,'OPEN',30,8),
    ('d2222222-0000-4000-8000-000000000028'::uuid,'d0000000-0000-4000-8000-0000000000c4'::uuid,'WEB_APP_DEVELOPMENT','CA','SRID=4326;POINT(-79.3900 43.6470)','Landing page + online menu for food truck','Launching a Brazilian food truck this spring. Need a single-page website with menu, location schedule and Instagram feed. Brand assets exist. Small budget but more work to follow.',1200,2500,'CAD',NULL,'OPEN',90,9),
    ('d2222222-0000-4000-8000-000000000029'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'CHILDCARE_BABYSITTING','GB','SRID=4326;POINT(-0.1180 51.5090)','After-school childcare, two kids (5 & 8)','Need a reliable childminder three afternoons a week — school pickup at 15:30, snacks, homework help until 18:30. Enhanced DBS preferred.',NULL,NULL,NULL,NULL,'OPEN',45,10),
    ('d2222222-0000-4000-8000-00000000002a'::uuid,'d0000000-0000-4000-8000-0000000000c2'::uuid,'MOBILE_MECHANIC','US','SRID=4326;POINT(-73.9200 40.7000)','Car will not start — battery or starter?','2014 Toyota Corolla cranks but will not start, parked on the street in Bed-Stuy. Suspect battery or starter motor. Need diagnosis and repair ASAP — I commute daily.',80,250,'USD',current_date+1,'OPEN',14,1),
    ('d2222222-0000-4000-8000-00000000002b'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'HAIRDRESSING','GB','SRID=4326;POINT(-0.1180 51.5090)','Knotless braids for graduation next month','Draft — checking dates with family before posting. Want waist-length knotless braids, small size, for graduation photos.',100,160,'GBP',NULL,'DRAFT',NULL,1),
    ('d2222222-0000-4000-8000-00000000002c'::uuid,'d0000000-0000-4000-8000-0000000000c3'::uuid,'VAN_MAN_HIRE','DE','SRID=4326;POINT(13.3800 52.5100)','Van + driver for IKEA pickup','Needed a driver with a van to collect a flat-pack wardrobe order from IKEA Tempelhof and carry it up two flights. Job completed — leaving a review.',60,100,'EUR',NULL,'OPEN',30,20)
) AS v(id,customer,cat_key,co2,point,title,description,bmin,bmax,ccy,pref,status,exp_days,pub_days)
JOIN users p ON p.id=v.customer
JOIN service_categories c ON c.category_key=v.cat_key
JOIN countries co ON co.iso2=v.co2
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 4. Provider responses (INTEREST and QUOTE)
-- --------------------------------------------------------------------------
INSERT INTO service_request_responses(id,service_request_id,service_provider_id,responded_by_user_id,response_type,message,quoted_amount,currency_code,status,created_at)
SELECT v.id,v.request_id,v.provider_id,v.actor,v.rtype,v.message,v.amount,v.ccy,'SENT',now()-v.days*interval '1 day'
FROM (VALUES
    ('d3333333-0000-4000-8000-000000000021'::uuid,'d2222222-0000-4000-8000-000000000021'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'QUOTE','Can come tomorrow morning. Tap replacement plus trap inspection — two hours of labour plus parts at cost.',95,'GBP',1),
    ('d3333333-0000-4000-8000-000000000022'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d1111111-0000-4000-8000-000000000012'::uuid,'d0000000-0000-4000-8000-000000000012'::uuid,'QUOTE','We do agency-standard end-of-tenancy cleans weekly. Includes oven, fridge, inside windows and descaling. Certificate provided for your inventory check.',185,'GBP',2),
    ('d3333333-0000-4000-8000-000000000023'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'INTEREST','I can help with minor repairs during your clean if needed — loose tiles, silicone and taps are my trade.',NULL,NULL,2),
    ('d3333333-0000-4000-8000-000000000024'::uuid,'d2222222-0000-4000-8000-000000000024'::uuid,'d1111111-0000-4000-8000-000000000014'::uuid,'d0000000-0000-4000-8000-000000000014'::uuid,'INTEREST','I tutor maths for kids after my salon hours — happy to do a trial session in Bed-Stuy.',NULL,NULL,3),
    ('d3333333-0000-4000-8000-000000000025'::uuid,'d2222222-0000-4000-8000-000000000025'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'QUOTE','Luton van plus two movers. Kreuzberg to Wedding is an easy half-day job — includes carry up the stairs.',280,'EUR',4),
    ('d3333333-0000-4000-8000-000000000026'::uuid,'d2222222-0000-4000-8000-000000000027'::uuid,'d1111111-0000-4000-8000-000000000013'::uuid,'d0000000-0000-4000-8000-000000000013'::uuid,'QUOTE','One full day with two gardeners: weeding, hedge trim, soil prep and planting perennials we supply at cost.',375,'CAD',5),
    ('d3333333-0000-4000-8000-000000000027'::uuid,'d2222222-0000-4000-8000-000000000028'::uuid,'d1111111-0000-4000-8000-000000000016'::uuid,'d0000000-0000-4000-8000-000000000016'::uuid,'QUOTE','Single-page site with menu, schedule section and Instagram embed. Two-week turnaround, includes one revision round.',1800,'CAD',6),
    ('d3333333-0000-4000-8000-000000000028'::uuid,'d2222222-0000-4000-8000-000000000029'::uuid,'d1111111-0000-4000-8000-000000000014'::uuid,'d0000000-0000-4000-8000-000000000014'::uuid,'INTEREST','I looked after two kids similar ages in Brooklyn for a year — references available. I am in NYC though, might be far.',NULL,NULL,7),
    ('d3333333-0000-4000-8000-000000000029'::uuid,'d2222222-0000-4000-8000-00000000002a'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'INTEREST','Not local but likely a dead battery — a jump and multimeter check will confirm it. Hope someone nearby helps.',NULL,NULL,1),
    ('d3333333-0000-4000-8000-00000000002c'::uuid,'d2222222-0000-4000-8000-00000000002c'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'QUOTE','Picked up from IKEA Tempelhof, carried up two flights, all done in one afternoon.',85,'EUR',15)
) AS v(id,request_id,provider_id,actor,rtype,message,amount,ccy,days)
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 5. Structured quotes — SENT for open requests, ACCEPTED for the three
--    completed jobs (inserted as ACCEPTED so engagements can reference them)
-- --------------------------------------------------------------------------
INSERT INTO service_quotes(id,service_request_id,service_provider_id,response_id,revision_no,submitted_by_user_id,title,scope_of_work,amount,currency_code,estimated_duration_value,estimated_duration_unit,valid_until,inclusions,status,sent_at,responded_at)
SELECT v.id,v.request_id,v.provider_id,v.response_id,1,v.actor,v.title,v.scope,v.amount,v.ccy,v.dur_val,v.dur_unit,now()+30*interval '1 day',v.incl,v.status,now()-v.days*interval '1 day',
       CASE WHEN v.status='ACCEPTED' THEN now()-(v.days-1)*interval '1 day' ELSE NULL END
FROM (VALUES
    ('d5555555-0000-4000-8000-000000000011'::uuid,'d2222222-0000-4000-8000-000000000021'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,'d3333333-0000-4000-8000-000000000021'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'Tap replacement and trap inspection','Replace the kitchen mixer tap, inspect and reseal the under-sink waste trap, test for leaks. Parts billed at cost with receipts.',95,'GBP',2,'HOUR','Labour, tap (mid-range mixer), trap seals and leak test','ACCEPTED',19),
    ('d5555555-0000-4000-8000-000000000012'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d1111111-0000-4000-8000-000000000012'::uuid,'d3333333-0000-4000-8000-000000000022'::uuid,'d0000000-0000-4000-8000-000000000012'::uuid,'End of tenancy deep clean','Full agency-standard deep clean of a 2-bed flat: oven, fridge, skirting, inside windows, bathroom descale, floors.',185,'GBP',1,'DAY','All cleaning materials, equipment and check-out certificate','ACCEPTED',17),
    ('d5555555-0000-4000-8000-000000000013'::uuid,'d2222222-0000-4000-8000-00000000002c'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,'d3333333-0000-4000-8000-00000000002c'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'IKEA collection and carry-up','Collect flat-pack wardrobe order from IKEA Tempelhof, deliver to Wedding and carry up two flights.',85,'EUR',3,'HOUR','Van, fuel and two-person carry','ACCEPTED',14),
    ('d5555555-0000-4000-8000-000000000014'::uuid,'d2222222-0000-4000-8000-000000000025'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,'d3333333-0000-4000-8000-000000000025'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'Flat move Kreuzberg to Wedding','Luton van plus two movers: load, transport and unload ~20 boxes, sofa, bed frame and desk.',280,'EUR',4,'HOUR','Van, fuel, movers, blankets and straps','SENT',4),
    ('d5555555-0000-4000-8000-000000000015'::uuid,'d2222222-0000-4000-8000-000000000027'::uuid,'d1111111-0000-4000-8000-000000000013'::uuid,'d3333333-0000-4000-8000-000000000026'::uuid,'d0000000-0000-4000-8000-000000000013'::uuid,'Backyard cleanup and planting','Two gardeners for one full day: weeding, hedge trim, soil prep and planting perennials (supplied at cost).',375,'CAD',1,'DAY','Labour, tools and green-waste removal','SENT',5),
    ('d5555555-0000-4000-8000-000000000016'::uuid,'d2222222-0000-4000-8000-000000000028'::uuid,'d1111111-0000-4000-8000-000000000016'::uuid,'d3333333-0000-4000-8000-000000000027'::uuid,'d0000000-0000-4000-8000-000000000016'::uuid,'Food truck landing page','Single-page responsive website with menu, weekly schedule section and Instagram embed. One revision round included.',1800,'CAD',2,'WEEK','Design, build, basic SEO and 30 days of support','SENT',6)
) AS v(id,request_id,provider_id,response_id,actor,title,scope,amount,ccy,dur_val,dur_unit,incl,status,days)
ON CONFLICT(id) DO NOTHING;

INSERT INTO service_quote_items(quote_id,line_no,description,quantity,unit_label,unit_amount,line_amount)
SELECT v.qid,v.line_no,v.description,v.qty,v.unit,v.unit_amount,v.line_amount
FROM (VALUES
    ('d5555555-0000-4000-8000-000000000011'::uuid,1,'Labour — tap replacement and trap reseal',2,'hour',35,70),
    ('d5555555-0000-4000-8000-000000000011'::uuid,2,'Mid-range mixer tap and seals',1,'item',25,25),
    ('d5555555-0000-4000-8000-000000000012'::uuid,1,'Deep clean — 2 bed flat, two cleaners',5,'hour',30,150),
    ('d5555555-0000-4000-8000-000000000012'::uuid,2,'Oven and fridge detail',1,'job',35,35)
) AS v(qid,line_no,description,qty,unit,unit_amount,line_amount)
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------
-- 6. Lead access — chat unlocked for the three completed jobs
--    (billing_usage_records mirror the backend's SERVICE_LEAD_ACCESS
--    consumption convention: user_id = provider owner,
--    target_type = 'SERVICE_REQUEST', idempotent key per pair)
-- --------------------------------------------------------------------------
INSERT INTO billing_usage_records(id,feature_id,user_id,quantity,target_type,target_id,idempotency_key,metadata,occurred_at)
SELECT v.id,f.id,v.owner,1,'SERVICE_REQUEST',v.request_id,v.ikey,'{}'::jsonb,now()-v.days*interval '1 day'
FROM (VALUES
    ('d4444444-0000-4000-8000-000000000041'::uuid,'d2222222-0000-4000-8000-000000000021'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'service-lead-access:d2222222-0000-4000-8000-000000000021:d1111111-0000-4000-8000-000000000011',19),
    ('d4444444-0000-4000-8000-000000000042'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d0000000-0000-4000-8000-000000000012'::uuid,'service-lead-access:d2222222-0000-4000-8000-000000000022:d1111111-0000-4000-8000-000000000012',17),
    ('d4444444-0000-4000-8000-000000000043'::uuid,'d2222222-0000-4000-8000-00000000002c'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'service-lead-access:d2222222-0000-4000-8000-00000000002c:d1111111-0000-4000-8000-000000000015',14)
) AS v(id,request_id,owner,ikey,days)
JOIN billing_features f ON f.feature_key='SERVICE_LEAD_ACCESS'
ON CONFLICT(id) DO NOTHING;

INSERT INTO service_lead_access(id,service_request_id,service_provider_id,chat_enabled,contact_details_unlocked,status,billing_usage_record_id,lead_price,lead_currency,granted_by_user_id,accessed_at)
SELECT v.id,v.request_id,v.provider_id,true,v.contacts,'ACTIVE',u.id,1,'USD',v.owner,now()-v.days*interval '1 day'
FROM (VALUES
    ('d6666666-0000-4000-8000-000000000041'::uuid,'d2222222-0000-4000-8000-000000000021'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,'d0000000-0000-4000-8000-000000000011'::uuid,'d4444444-0000-4000-8000-000000000041'::uuid,true,19),
    ('d6666666-0000-4000-8000-000000000042'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d1111111-0000-4000-8000-000000000012'::uuid,'d0000000-0000-4000-8000-000000000012'::uuid,'d4444444-0000-4000-8000-000000000042'::uuid,true,17),
    ('d6666666-0000-4000-8000-000000000043'::uuid,'d2222222-0000-4000-8000-00000000002c'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,'d0000000-0000-4000-8000-000000000015'::uuid,'d4444444-0000-4000-8000-000000000043'::uuid,true,14)
) AS v(id,request_id,provider_id,owner,usage_id,contacts,days)
JOIN billing_usage_records u ON u.id=v.usage_id
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 7. Completed engagements on the three accepted quotes
-- --------------------------------------------------------------------------
INSERT INTO service_engagements(id,service_request_id,accepted_quote_id,service_provider_id,customer_user_id,status,accepted_at,started_at,completion_submitted_at,completed_at,provider_completion_note,customer_completion_note)
VALUES
    ('d7777777-0000-4000-8000-000000000051','d2222222-0000-4000-8000-000000000021','d5555555-0000-4000-8000-000000000011','d1111111-0000-4000-8000-000000000011','d0000000-0000-4000-8000-0000000000c1','COMPLETED',now()-interval '18 days',now()-interval '16 days',now()-interval '15 days',now()-interval '15 days','Replaced the tap and resealed the trap — no more dripping. Left the receipts for the mixer tap.',''),
    ('d7777777-0000-4000-8000-000000000052','d2222222-0000-4000-8000-000000000022','d5555555-0000-4000-8000-000000000012','d1111111-0000-4000-8000-000000000012','d0000000-0000-4000-8000-0000000000c1','COMPLETED',now()-interval '16 days',now()-interval '12 days',now()-interval '11 days',now()-interval '11 days','Deep clean finished to inventory standard — certificate left on the kitchen counter.',''),
    ('d7777777-0000-4000-8000-000000000053','d2222222-0000-4000-8000-00000000002c','d5555555-0000-4000-8000-000000000013','d1111111-0000-4000-8000-000000000015','d0000000-0000-4000-8000-0000000000c3','COMPLETED',now()-interval '14 days',now()-interval '13 days',now()-interval '12 days',now()-interval '12 days','Wardrobe collected from Tempelhof and carried up — assembled in the hallway.','')
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 8. Published reviews (each reviewer is the request customer; every review
--    is backed by a COMPLETED engagement created above)
-- --------------------------------------------------------------------------
INSERT INTO service_reviews(id,service_request_id,reviewer_user_id,service_provider_id,rating,review_text,status,provider_response,provider_response_by_user_id,provider_responded_at,created_at)
SELECT v.id,v.request_id,v.reviewer,v.provider_id,v.rating,v.review_text,'PUBLISHED',v.provider_response,v.pr_by,
       CASE WHEN v.pr_days IS NULL THEN NULL ELSE now()-v.pr_days*interval '1 day' END,
       now()-v.days*interval '1 day'
FROM (VALUES
    ('d8888888-0000-4000-8000-000000000061'::uuid,'d2222222-0000-4000-8000-00000000002c'::uuid,'d0000000-0000-4000-8000-0000000000c3'::uuid,'d1111111-0000-4000-8000-000000000015'::uuid,5,'Omar collected our IKEA order within hours of posting and carried everything up two flights without a scratch. Fair price, punctual, friendly — highly recommended.','Thank you Fatima! Glad everything arrived safely — always happy to help.','d0000000-0000-4000-8000-000000000015'::uuid,10,11),
    ('d8888888-0000-4000-8000-000000000062'::uuid,'d2222222-0000-4000-8000-000000000021'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'d1111111-0000-4000-8000-000000000011'::uuid,4,'Amara replaced the tap quickly and explained what caused the leak. Tidy work — only minor note is she arrived a little later than agreed.',NULL,NULL,NULL,10),
    ('d8888888-0000-4000-8000-000000000063'::uuid,'d2222222-0000-4000-8000-000000000022'::uuid,'d0000000-0000-4000-8000-0000000000c1'::uuid,'d1111111-0000-4000-8000-000000000012'::uuid,5,'The flat passed the inventory check with zero deductions. Chidinma''s team were thorough and even caught a stain the agent would definitely have flagged.',NULL,NULL,NULL,8)
) AS v(id,request_id,reviewer,provider_id,rating,review_text,provider_response,pr_by,pr_days,days)
ON CONFLICT(id) DO NOTHING;

-- --------------------------------------------------------------------------
-- 9. Close the three completed jobs (responses/quotes/leads were granted
--    while they were still OPEN)
-- --------------------------------------------------------------------------
UPDATE service_requests
SET status='CLOSED', updated_at=now()
WHERE id IN ('d2222222-0000-4000-8000-000000000021',
             'd2222222-0000-4000-8000-000000000022',
             'd2222222-0000-4000-8000-00000000002c')
  AND status='OPEN'
  AND EXISTS (SELECT 1 FROM service_engagements e
              WHERE e.service_request_id=service_requests.id);

-- --------------------------------------------------------------------------
-- Summary
-- --------------------------------------------------------------------------
SELECT count(*) AS demo_users FROM users WHERE id::text LIKE 'd0000000%';
SELECT count(*) AS service_categories FROM service_categories;
SELECT status,count(*) AS service_requests FROM service_requests GROUP BY status ORDER BY 1;
SELECT count(*) AS service_providers FROM service_providers;
SELECT count(*) AS responses FROM service_request_responses;
SELECT status,count(*) AS quotes FROM service_quotes GROUP BY status ORDER BY 1;
SELECT count(*) AS engagements FROM service_engagements;
SELECT count(*) AS lead_accesses FROM service_lead_access;
SELECT count(*) AS reviews FROM service_reviews;
