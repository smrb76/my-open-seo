CREATE TABLE "top_stories_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"url_key" text NOT NULL,
	"title" text,
	"normalized_title" text,
	"published_at" text,
	"published_at_source" text,
	"first_seen_in_sitemap_at" text,
	"first_crawled_at" text,
	"crawl_source" text,
	"crawl_checked_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_stories_results" (
	"snapshot_id" text NOT NULL,
	"position" integer NOT NULL,
	"domain" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"source_name" text,
	"published_at" text,
	CONSTRAINT "top_stories_results_snapshot_id_position_pk" PRIMARY KEY("snapshot_id","position")
);
--> statement-breakpoint
CREATE TABLE "top_stories_settings" (
	"project_id" text PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"location_code" integer DEFAULT 2364 NOT NULL,
	"language_code" text DEFAULT 'fa' NOT NULL,
	"device" text DEFAULT 'mobile' NOT NULL,
	"snapshot_interval_minutes" integer DEFAULT 30 NOT NULL,
	"tracking_window_hours" integer DEFAULT 6 NOT NULL,
	"max_auto_topics_per_day" integer DEFAULT 40 NOT NULL,
	"trends_import_enabled" boolean DEFAULT true NOT NULL,
	"trends_geo" text DEFAULT 'IR' NOT NULL,
	"gsc_import_enabled" boolean DEFAULT true NOT NULL,
	"last_trends_import_at" text,
	"last_trends_error" text,
	"last_gsc_import_at" text,
	"last_gsc_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_stories_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text NOT NULL,
	"is_own" boolean DEFAULT false NOT NULL,
	"news_sitemap_url" text,
	"last_fetched_at" text,
	"last_success_at" text,
	"last_fetch_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_stories_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"checked_at" text NOT NULL,
	"has_top_stories" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "top_stories_topic_articles" (
	"topic_id" text NOT NULL,
	"site_id" text NOT NULL,
	"article_id" text NOT NULL,
	"matched_by" text NOT NULL,
	CONSTRAINT "top_stories_topic_articles_topic_id_site_id_pk" PRIMARY KEY("topic_id","site_id")
);
--> statement-breakpoint
CREATE TABLE "top_stories_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"source" text NOT NULL,
	"tracking_ends_at" text NOT NULL,
	"next_snapshot_at" text,
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "top_stories_articles" ADD CONSTRAINT "top_stories_articles_site_id_top_stories_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."top_stories_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_results" ADD CONSTRAINT "top_stories_results_snapshot_id_top_stories_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."top_stories_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_settings" ADD CONSTRAINT "top_stories_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_sites" ADD CONSTRAINT "top_stories_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_snapshots" ADD CONSTRAINT "top_stories_snapshots_topic_id_top_stories_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."top_stories_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_topic_articles" ADD CONSTRAINT "top_stories_topic_articles_topic_id_top_stories_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."top_stories_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_topic_articles" ADD CONSTRAINT "top_stories_topic_articles_site_id_top_stories_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."top_stories_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_topic_articles" ADD CONSTRAINT "top_stories_topic_articles_article_id_top_stories_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."top_stories_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_stories_topics" ADD CONSTRAINT "top_stories_topics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "top_stories_articles_site_url_idx" ON "top_stories_articles" USING btree ("site_id","url_key");--> statement-breakpoint
CREATE INDEX "top_stories_articles_site_published_idx" ON "top_stories_articles" USING btree ("site_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "top_stories_sites_project_domain_idx" ON "top_stories_sites" USING btree ("project_id","domain");--> statement-breakpoint
CREATE INDEX "top_stories_snapshots_topic_checked_idx" ON "top_stories_snapshots" USING btree ("topic_id","checked_at");--> statement-breakpoint
CREATE INDEX "top_stories_topics_project_created_idx" ON "top_stories_topics" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "top_stories_topics_next_snapshot_idx" ON "top_stories_topics" USING btree ("next_snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "top_stories_topics_active_query_idx" ON "top_stories_topics" USING btree ("project_id","normalized_query") WHERE "top_stories_topics"."next_snapshot_at" IS NOT NULL;