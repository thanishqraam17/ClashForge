-- Phase 7 builder correction: distinguishes ordinary Builder Huts from B.O.B.
-- (the distinct, permanent sixth Home Village builder) instead of treating
-- every builder as an undifferentiated slot.
--
-- Every existing row becomes 'legacy-unclassified': nothing is inferred from
-- its slot number or from how many rows exist. A village with 5 or 6 rows is
-- not assumed to be "5 confirmed huts" or "5 huts + B.O.B." — that would
-- invent ownership history the data doesn't actually contain. The player
-- confirms ownership explicitly (a later service adds that flow); existing
-- builder ids, slots and every village_items.builder_id reference are
-- completely untouched by this migration.

ALTER TABLE builders ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy-unclassified'
  CHECK (kind IN ('ordinary', 'bob', 'legacy-unclassified'));

-- At most one B.O.B. row per village. Ordinary huts have no equivalent cap
-- here (SQLite CHECK cannot count rows); that is enforced by the service.
CREATE UNIQUE INDEX idx_builders_bob ON builders (village_id) WHERE kind = 'bob';
