-- One row for the household (id = 'home'). `data` is the record of assets/stars.js: stars by number and colour only, never a name. `rev` goes up by one on every write.
CREATE TABLE records (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
-- The last copy of each day (Japan time), and a copy taken just before 「ぜんぶ けす」/「まえの日に もどす」 (day 'YYYY-MM-DD~HHMMSS'). Kept 30 days.
CREATE TABLE history (day TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL);
