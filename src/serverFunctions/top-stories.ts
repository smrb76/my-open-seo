import { createServerFn } from "@tanstack/react-start";
import { TopStoriesService } from "@/server/features/top-stories/services/TopStoriesService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  addTopStoriesSiteSchema,
  addTopStoriesTopicsSchema,
  importCrawlLogSchema,
  importTopStoriesTopicsSchema,
  setTopStoriesTopicArticleSchema,
  topStoriesProjectSchema,
  topStoriesReportSchema,
  topStoriesSiteSchema,
  topStoriesTopicSchema,
  updateTopStoriesSettingsSchema,
  updateTopStoriesSiteSchema,
} from "@/types/schemas/top-stories";

export const getTopStoriesOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesProjectSchema)
  .handler(async ({ context }) => {
    const overview = await TopStoriesService.getOverview(context.projectId);
    return { ...overview, projectDomain: context.project.domain };
  });

export const enableTopStories = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesProjectSchema)
  .handler(async ({ context }) => {
    await TopStoriesService.enable({
      projectId: context.projectId,
      ownDomain: context.project.domain,
    });
    return { success: true };
  });

export const updateTopStoriesSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateTopStoriesSettingsSchema)
  .handler(async ({ data, context }) => {
    const { projectId: _projectId, ...patch } = data;
    await TopStoriesService.updateSettings(context.projectId, patch);
    return { success: true };
  });

export const addTopStoriesSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addTopStoriesSiteSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.addSite({
      projectId: context.projectId,
      domain: data.domain,
      isOwn: data.isOwn,
      newsSitemapUrl: data.newsSitemapUrl,
    });
  });

export const updateTopStoriesSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateTopStoriesSiteSchema)
  .handler(async ({ data, context }) => {
    await TopStoriesService.updateSite({
      projectId: context.projectId,
      siteId: data.siteId,
      isOwn: data.isOwn,
      newsSitemapUrl: data.newsSitemapUrl,
    });
    return { success: true };
  });

export const deleteTopStoriesSite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesSiteSchema)
  .handler(async ({ data, context }) => {
    await TopStoriesService.deleteSite(context.projectId, data.siteId);
    return { success: true };
  });

export const fetchTopStoriesSiteNow = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesSiteSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.fetchSiteNow(context.projectId, data.siteId);
  });

export const addTopStoriesTopics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(addTopStoriesTopicsSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.addTopics(context.projectId, data.queries);
  });

export const importTopStoriesTopics = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importTopStoriesTopicsSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.importTopicsNow(context.projectId, data.source);
  });

export const stopTopStoriesTopic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesTopicSchema)
  .handler(async ({ data, context }) => {
    await TopStoriesService.stopTopic(context.projectId, data.topicId);
    return { success: true };
  });

export const deleteTopStoriesTopic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesTopicSchema)
  .handler(async ({ data, context }) => {
    await TopStoriesService.deleteTopic(context.projectId, data.topicId);
    return { success: true };
  });

export const getTopStoriesTopicSnapshots = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesTopicSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.getTopicSnapshots(context.projectId, data.topicId);
  });

export const setTopStoriesTopicArticle = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(setTopStoriesTopicArticleSchema)
  .handler(async ({ data, context }) => {
    await TopStoriesService.setTopicArticle({
      projectId: context.projectId,
      topicId: data.topicId,
      siteId: data.siteId,
      url: data.url,
    });
    return { success: true };
  });

export const getTopStoriesReport = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(topStoriesReportSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.getReport({
      projectId: context.projectId,
      from: new Date(data.from).toISOString(),
      to: new Date(data.to).toISOString(),
    });
  });

export const importTopStoriesCrawlLog = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(importCrawlLogSchema)
  .handler(async ({ data, context }) => {
    return TopStoriesService.importCrawlLog({
      projectId: context.projectId,
      lines: data.lines,
      verifyGooglebotIps: data.verifyGooglebotIps,
    });
  });
