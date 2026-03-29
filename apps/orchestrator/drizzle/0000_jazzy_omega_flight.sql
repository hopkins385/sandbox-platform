CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`container_id` text,
	`host_port_3000` integer,
	`host_port_4001` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
