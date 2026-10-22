ALTER TABLE `Cards` ADD `step` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `Cards` ADD `drill` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Cards already being reviewed join the ladder at the rung closest to (not above) their current gap; new cards
-- start with the first drill.
UPDATE `Cards` SET `step` = CASE
  WHEN `intervalDays` >= 365 THEN 9 WHEN `intervalDays` >= 240 THEN 8 WHEN `intervalDays` >= 120 THEN 7
  WHEN `intervalDays` >= 60 THEN 6 WHEN `intervalDays` >= 30 THEN 5 WHEN `intervalDays` >= 14 THEN 4
  WHEN `intervalDays` >= 7 THEN 3 WHEN `intervalDays` >= 3 THEN 2 WHEN `intervalDays` >= 1 THEN 1 ELSE 0 END
WHERE `state` != 'new';
