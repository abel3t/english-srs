CREATE TABLE `Activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`words` real NOT NULL,
	`studySeconds` real NOT NULL,
	`accuracy` real,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "activities_kind" CHECK("Activities"."kind" IN ('typing', 'listening'))
);
--> statement-breakpoint
CREATE INDEX `idx_activities_user` ON `Activities` (`userId`,`createdAt`);