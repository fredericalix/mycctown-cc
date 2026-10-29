-- The organisations table was a best-effort cache populated from /api/orgs
-- and only consumed by the WS handler to check whether a user could open a
-- stream for a given org. Since every user now has a row in `maps` for each
-- org they've opened, we use that as the access signal instead — it's the
-- same invariant without the maintenance of a separate cache.

DROP TABLE IF EXISTS organisations;
