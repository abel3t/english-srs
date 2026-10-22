CREATE TABLE `Accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_user` ON `Accounts` (`userId`);--> statement-breakpoint
CREATE TABLE `Candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`phrase` text NOT NULL,
	`normalizedPhrase` text NOT NULL,
	`example` text,
	`source` text,
	`kind` text NOT NULL,
	`partId` integer,
	`draft` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`skipReason` text,
	`decidedAt` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partId`) REFERENCES `DocumentParts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "candidates_kind" CHECK("Candidates"."kind" IN ('ai', 'capture')),
	CONSTRAINT "candidates_status" CHECK("Candidates"."status" IN ('pending', 'learned', 'dismissed')),
	CONSTRAINT "candidates_skip_reason" CHECK("Candidates"."skipReason" IN ('known', 'not_useful'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidates_user_phrase` ON `Candidates` (`userId`,`normalizedPhrase`);--> statement-breakpoint
CREATE INDEX `idx_candidates_status` ON `Candidates` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_candidates_part` ON `Candidates` (`partId`);--> statement-breakpoint
CREATE TABLE `Cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`phrase` text NOT NULL,
	`normalizedPhrase` text NOT NULL,
	`explanation` text NOT NULL,
	`keyExpression` text DEFAULT '' NOT NULL,
	`examples` text DEFAULT '[]' NOT NULL,
	`originalInput` text,
	`context` text,
	`state` text DEFAULT 'new' NOT NULL,
	`dueAt` text NOT NULL,
	`intervalDays` real DEFAULT 0 NOT NULL,
	`ease` real DEFAULT 2.5 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`lastReviewedAt` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cards_state" CHECK("Cards"."state" IN ('new', 'learning', 'review'))
);
--> statement-breakpoint
CREATE INDEX `idx_cards_due` ON `Cards` (`userId`,`dueAt`);--> statement-breakpoint
CREATE INDEX `idx_cards_normalized` ON `Cards` (`userId`,`normalizedPhrase`);--> statement-breakpoint
CREATE INDEX `idx_cards_created` ON `Cards` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `ConnectorTokens` (
	`tokenHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ConnectorTokens_userId_unique` ON `ConnectorTokens` (`userId`);--> statement-breakpoint
CREATE TABLE `DocumentParts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`documentId` integer NOT NULL,
	`position` integer NOT NULL,
	`chapterTitle` text NOT NULL,
	`text` text NOT NULL,
	`words` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`processedAt` text,
	FOREIGN KEY (`documentId`) REFERENCES `Documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_parts_status" CHECK("DocumentParts"."status" IN ('pending', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_parts_position` ON `DocumentParts` (`documentId`,`position`);--> statement-breakpoint
CREATE INDEX `idx_document_parts_status` ON `DocumentParts` (`status`,`documentId`,`position`);--> statement-breakpoint
CREATE TABLE `Documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`format` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "documents_format" CHECK("Documents"."format" IN ('pdf', 'epub', 'docx', 'text'))
);
--> statement-breakpoint
CREATE INDEX `idx_documents_user` ON `Documents` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `Reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cardId` integer NOT NULL,
	`rating` text NOT NULL,
	`stateBefore` text NOT NULL,
	`intervalBefore` real NOT NULL,
	`intervalAfter` real NOT NULL,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`accuracy` real,
	`reviewedAt` text NOT NULL,
	FOREIGN KEY (`cardId`) REFERENCES `Cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reviews_rating" CHECK("Reviews"."rating" IN ('again', 'hard', 'good', 'easy'))
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_card` ON `Reviews` (`cardId`);--> statement-breakpoint
CREATE INDEX `idx_reviews_reviewed` ON `Reviews` (`reviewedAt`);--> statement-breakpoint
CREATE TABLE `Sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`impersonatedBy` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Sessions_token_unique` ON `Sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_user` ON `Sessions` (`userId`);--> statement-breakpoint
CREATE TABLE `Stories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`lines` text NOT NULL,
	`phrases` text DEFAULT '[]' NOT NULL,
	`audioKey` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "stories_kind" CHECK("Stories"."kind" IN ('story', 'conversation'))
);
--> statement-breakpoint
CREATE INDEX `idx_stories_created` ON `Stories` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `UserSettings` (
	`userId` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updatedAt` text NOT NULL,
	PRIMARY KEY(`userId`, `key`),
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text,
	`banned` integer DEFAULT false,
	`banReason` text,
	`banExpires` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Users_email_unique` ON `Users` (`email`);--> statement-breakpoint
CREATE TABLE `Verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_verification_identifier` ON `Verifications` (`identifier`);