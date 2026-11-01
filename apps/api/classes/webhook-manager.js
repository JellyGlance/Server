const axios = require('axios');
const dbInstance = require('../db');
const EventEmitter = require('events');
const configClass = require('./config');
const { addWebhookDelivery, getSettings, mergeSettings } = require('./admin-history');
const { enrichDiscordPayload, enrichGotifyPayload, postDiscordWebhook } = require('./discord-webhook-media');
const { hostnameEquals, sanitizeForLog } = require('../utils/security');
const { createPlaybackEventGate } = require('../utils/playback-notify');

function parseClockMinutes(value, fallback) {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return parseClockMinutes(fallback, '22:00');
    return Number(match[1]) * 60 + Number(match[2]);
}

function isWebhookQuietHours(settings, eventType) {
    const quiet = settings?.WebhookQuietHours;
    if (!quiet?.enabled) return false;
    const events = Array.isArray(quiet.events) && quiet.events.length
        ? quiet.events
        : ['playback_started', 'playback_ended'];
    if (!events.includes(eventType)) return false;
    const start = parseClockMinutes(quiet.start, '22:00');
    const end = parseClockMinutes(quiet.end, '08:00');
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (start === end) return true;
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
}

class WebhookManager {
    constructor() {
        if (WebhookManager.instance) {
            return WebhookManager.instance;
        }

        this.eventEmitter = new EventEmitter();
        this.coalescedWebhooks = new Map();
        this._flushingDigest = false;
        this.setupEventListeners();
        WebhookManager.instance = this;
    }

    setupEventListeners() {
        // Adding event listeners for different events
        this.eventEmitter.on('playback_started', async (data) => {
            await this.triggerEventWebhooks('playback_started', data);
        });

        this.eventEmitter.on('playback_ended', async (data) => {
            await this.triggerEventWebhooks('playback_ended', data);
        });

        this.eventEmitter.on('media_recently_added', async (data) => {
            await this.triggerEventWebhooks('media_recently_added', data);
        });

        this.eventEmitter.on('task_started', async (data) => {
            await this.triggerEventWebhooks('task_started', data);
        });

        this.eventEmitter.on('task_completed', async (data) => {
            await this.triggerEventWebhooks('task_completed', data);
        });

        this.eventEmitter.on('task_failed', async (data) => {
            await this.triggerEventWebhooks('task_failed', data);
        });

        [
            'calendar_refreshed',
            'download_queue_refreshed',
            'download_added',
            'download_started',
            'download_completed',
            'download_failed',
            'invite_created',
            'invite_deleted',
            'invite_links_refreshed',
            'integration_health_warning',
            'device_authorized',
            'ops_digest',
            'playback_digest',
            'threshold_alert'
        ].forEach((eventType) => {
            this.eventEmitter.on(eventType, async (data) => {
                await this.triggerEventWebhooks(eventType, data);
            });
        });
    }

    async getWebhooksByEventType(eventType, webhookIds = null) {
        if (Array.isArray(webhookIds) && webhookIds.length > 0) {
            return await dbInstance.query(
                'SELECT * FROM webhooks WHERE trigger_type = $1 AND event_type = $2 AND id = ANY($3::int[])',
                ['event', eventType, webhookIds]
            ).then(res => res.rows);
        }

        return await dbInstance.query(
            'SELECT * FROM webhooks WHERE trigger_type = $1 AND event_type = $2 AND enabled = true',
            ['event', eventType]
        ).then(res => res.rows);
    }

    async getScheduledWebhooks() {
        return await dbInstance.query(
            'SELECT * FROM webhooks WHERE trigger_type = $1 AND enabled = true',
            ['scheduled']
        ).then(res => res.rows);
    }

    summarizePlaybackEvent(eventType, data = {}) {
        return {
            event: eventType,
            user: data.UserName || data.userData?.username || 'Someone',
            title: data.ItemName || data.mediaInfo?.mediaName || 'media',
            series: data.SeriesName || data.mediaInfo?.seriesName || '',
            at: new Date().toISOString(),
        };
    }

    async queueQuietPlayback(eventType, data = {}) {
        try {
            const settings = await getSettings();
            const quiet = settings.WebhookQuietHours || {};
            if (quiet.digest === false) return;
            const next = [...(Array.isArray(settings.WebhookQuietBuffer) ? settings.WebhookQuietBuffer : []), this.summarizePlaybackEvent(eventType, data)].slice(-80);
            await mergeSettings({ WebhookQuietBuffer: next });
        } catch (error) {
            console.error('[WEBHOOK] Unable to queue quiet-hours playback:', error.message);
        }
    }

    async flushQuietHoursDigest() {
        if (this._flushingDigest) return true;
        this._flushingDigest = true;
        try {
            const settings = await getSettings();
            const quiet = settings.WebhookQuietHours || {};
            const buffer = Array.isArray(settings.WebhookQuietBuffer) ? settings.WebhookQuietBuffer : [];
            if (!buffer.length || quiet.digest === false) return true;
            if (quiet.enabled && isWebhookQuietHours(settings, 'playback_started')) return true;

            await mergeSettings({ WebhookQuietBuffer: [], WebhookQuietFlushedAt: new Date().toISOString() });

            const started = buffer.filter((row) => row.event === 'playback_started').length;
            const ended = buffer.filter((row) => row.event === 'playback_ended').length;
            const titles = [...new Set(buffer.map((row) => [row.user, row.series || row.title].filter(Boolean).join(' · ')))].slice(0, 12);
            const payload = {
                integrationEvent: 'Overnight playback digest',
                source: 'Webhooks',
                count: buffer.length,
                started,
                ended,
                titles,
                items: buffer,
                message: `${buffer.length} playback event${buffer.length === 1 ? '' : 's'} during quiet hours (${started} started, ${ended} stopped). ${titles.slice(0, 4).join('; ')}`,
            };

            const digestHooks = await this.getWebhooksByEventType('playback_digest');
            const fallbackHooks = digestHooks.length ? [] : await this.getWebhooksByEventType('playback_started');
            const targets = [...digestHooks, ...fallbackHooks].filter((webhook, index, rows) => rows.findIndex((row) => row.id === webhook.id) === index);
            if (!targets.length) return true;
            const enriched = { ...payload, event: 'playback_digest', triggeredAt: new Date().toISOString() };
            const results = await Promise.all(targets.map((webhook) => this.executeWebhook(webhook, enriched)));
            return results.every(Boolean);
        } catch (error) {
            console.error('[WEBHOOK] Quiet-hours digest failed:', error.message);
            return false;
        } finally {
            this._flushingDigest = false;
        }
    }

    async triggerEventWebhooks(eventType, data = {}, webhookIds = null) {
        try {
            if (!webhookIds && eventType !== 'playback_digest') {
                await this.flushQuietHoursDigest();
            }
            if (!webhookIds) {
                const config = await new configClass().getConfig().catch(() => ({}));
                if (isWebhookQuietHours(config.settings, eventType)) {
                    console.log(`[WEBHOOK] Quiet hours skip ${eventType}`);
                    if (eventType === 'playback_started' || eventType === 'playback_ended') {
                        await this.queueQuietPlayback(eventType, data);
                    }
                    return true;
                }
            }
            const webhooks = (await this.getWebhooksByEventType(eventType, webhookIds)).filter((webhook) => {
                if (!String(eventType).startsWith('task_')) {
                    return true;
                }

                let payload = {};
                try {
                    payload = typeof webhook.payload === 'string'
                        ? JSON.parse(webhook.payload || '{}')
                        : (webhook.payload || {});
                } catch {
                    payload = {};
                }

                const taskFilters = Array.isArray(payload.taskFilters) ? payload.taskFilters.filter(Boolean) : [];
                if (taskFilters.length === 0) {
                    return true;
                }

                return taskFilters.includes(data.taskKey) || taskFilters.includes(data.taskName);
            });
            
            if (webhooks.length === 0) {
                this.lastError = {
                    message: `No matching enabled webhook found for ${eventType}`,
                };
                console.log(`[WEBHOOK] No webhooks registered for event: ${eventType}`);
                return false;
            }
            
            console.log(`[WEBHOOK] Triggering ${webhooks.length} webhooks for event: ${eventType}`);
            
            const enrichedData = {
                ...data,
                event: eventType,
                triggeredAt: new Date().toISOString()
            };

            if (data.sessionInfo || data.mediaInfo || data.userData) {
                Object.assign(enrichedData, {
                    UserId: data.userData?.userId || data.sessionInfo?.userId,
                    UserName: data.userData?.username,
                    ItemId: data.mediaInfo?.itemId,
                    ItemName: data.mediaInfo?.mediaName,
                    MediaType: data.mediaInfo?.mediaType,
                    SeriesName: data.mediaInfo?.seriesName,
                    EpisodeId: data.mediaInfo?.episodeId,
                    SeasonNumber: data.mediaInfo?.seasonNumber,
                    EpisodeNumber: data.mediaInfo?.episodeNumber,
                    DeviceName: data.sessionInfo?.deviceName,
                    ClientName: data.sessionInfo?.clientName,
                    PlayMethod: data.sessionInfo?.playMethod || data.mediaInfo?.playMethod,
                    IsPaused: data.sessionInfo?.isPaused,
                    PlaybackDuration: data.sessionInfo?.playbackDuration,
                    StartTime: data.sessionInfo?.startTime,
                    EndTime: data.sessionInfo?.endTime,
                });
            }

            if (!this.shouldEmitPlaybackWebhook(eventType, enrichedData)) {
                console.log(`[WEBHOOK] Skipping duplicate ${eventType}`);
                return true;
            }

            const promises = webhooks.map((webhook) => {
                if (!webhookIds && this.shouldCoalesceWebhook(webhook, eventType)) {
                    return this.enqueueCoalescedWebhook(webhook, eventType, enrichedData);
                }
                return this.executeWebhook(webhook, enrichedData);
            });
            
            const results = await Promise.all(promises);
            
            return results.every(Boolean);
        } catch (error) {
            this.lastError = {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
            console.error(`[WEBHOOK] Error triggering webhooks for event ${eventType}:`, error);
            return false;
        }
    }

    async executeWebhook(webhook, data = {}) {
        try {
            let headers = {};
            let payload = {};

            const isDiscordWebhook = webhook.url.includes('discord.com/api/webhooks') || webhook.webhook_type === 'discord';
            const isGotifyWebhook = webhook.webhook_type === 'gotify';
            const isNtfyWebhook = webhook.webhook_type === 'ntfy' || /ntfy/i.test(String(webhook.url || ""));
            const isTelegramWebhook = webhook.webhook_type === 'telegram' || hostnameEquals(webhook.url, 'api.telegram.org');
            const isPushoverWebhook = webhook.webhook_type === 'pushover' || hostnameEquals(webhook.url, 'api.pushover.net');

            try {
                headers = typeof webhook.headers === 'string'
                    ? JSON.parse(webhook.headers || '{}')
                    : (webhook.headers || {});

                payload = typeof webhook.payload === 'string'
                    ? JSON.parse(webhook.payload || '{}')
                    : (webhook.payload || {});
            } catch (e) {
                this.lastError = {
                    message: `Invalid webhook headers or payload JSON: ${e.message}`,
                };
                console.error("[WEBHOOK] Error while parsing:", e);
                return false;
            }

            const discordMetaKeys = new Set(["taskFilters", "events", "rows", "groupKey"]);
            const payloadIsEmpty = Object.keys(payload).filter((key) => !discordMetaKeys.has(key)).length === 0;
            const title = this.getDefaultTitle(data);
            const message = this.getDefaultMessage(data);

            let response;

            if (isDiscordWebhook) {
                console.log("[WEBHOOK] Webhook Discord detected");
                const templatePayload = payloadIsEmpty ? {} : payload;
                const compiledPayload = this.compileTemplate(templatePayload, data);
                try {
                    const { payload: discordPayload, files } = await enrichDiscordPayload(compiledPayload, data);
                    response = await postDiscordWebhook(webhook.url, discordPayload, files);
                } catch (discordError) {
                    console.warn("[WEBHOOK] Discord rich payload failed, sending text fallback:", discordError.message);
                    response = await axios.post(webhook.url, { content: `**${title}**\n${message}` }, {
                        headers: { "Content-Type": "application/json" },
                        timeout: 10000,
                    });
                }

                console.log(`[WEBHOOK] Discord webhook ${webhook.name} send successfully`);
            } else if (isGotifyWebhook) {
                console.log("[WEBHOOK] Webhook Gotify detected");
                const compiledPayload = payloadIsEmpty || !payload.message
                    ? await enrichGotifyPayload({
                        priority: data.priority ?? payload.priority ?? 5,
                        ...(payload.extras ? { extras: payload.extras } : {}),
                    }, data)
                    : this.compileTemplate(payload, data);

                if (!compiledPayload.message) {
                    compiledPayload.message = data.message || message || 'JellyGlance webhook test';
                }

                response = await axios({
                    method: webhook.method || 'POST',
                    url: webhook.url,
                    headers: { 'Content-Type': 'application/json', ...headers },
                    data: compiledPayload,
                    timeout: 15000,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                });

                console.log(`[WEBHOOK] Gotify webhook ${webhook.name} send successfully`);
            } else if (isNtfyWebhook) {
                const ntfyHeaders = {
                    Title: title.slice(0, 120),
                    Priority: String(data.priority || (String(data.event || "").includes("fail") ? 5 : 3)),
                    Tags: "jellyfin,jellyglance",
                    ...headers,
                };
                response = await axios.post(webhook.url, message, {
                    headers: ntfyHeaders,
                    timeout: 15000,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                });
                console.log(`[WEBHOOK] ntfy webhook ${webhook.name} send successfully`);
            } else if (isTelegramWebhook) {
                const parsed = new URL(webhook.url);
                const chatId = parsed.searchParams.get("chat_id") || payload.chat_id || headers.chat_id;
                const telegramBody = {
                    chat_id: chatId,
                    text: `*${title}*\n${message}`,
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                };
                if (!telegramBody.chat_id) {
                    throw new Error("Telegram webhooks need chat_id in the URL query or payload");
                }
                response = await axios.post(parsed.origin + parsed.pathname, telegramBody, {
                    headers: { "Content-Type": "application/json", ...headers },
                    timeout: 15000,
                });
                console.log(`[WEBHOOK] Telegram webhook ${webhook.name} send successfully`);
            } else if (isPushoverWebhook) {
                const parsed = new URL(webhook.url);
                const token = parsed.searchParams.get("token") || payload.token || headers.token;
                const user = parsed.searchParams.get("user") || payload.user || headers.user;
                if (!token || !user) {
                    throw new Error("Pushover webhooks need token and user in the URL query");
                }
                const body = new URLSearchParams({
                    token,
                    user,
                    title: title.slice(0, 250),
                    message: message.slice(0, 1024) || "JellyGlance notification",
                    priority: String(data.priority || (String(data.event || "").includes("fail") ? 1 : 0)),
                });
                response = await axios.post("https://api.pushover.net/1/messages.json", body.toString(), {
                    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
                    timeout: 15000,
                });
                console.log(`[WEBHOOK] Pushover webhook ${webhook.name} send successfully`);
            } else {
                const templatePayload = payloadIsEmpty
                    ? {
                        title,
                        message,
                        data
                    }
                    : payload;
                const compiledPayload = this.compileTemplate(templatePayload, data);

                response = await axios({
                    method: webhook.method || 'POST',
                    url: webhook.url,
                    headers: { 'Content-Type': 'application/json', ...headers },
                    data: compiledPayload,
                    timeout: 10000
                });

                console.log(`[WEBHOOK] Webhook ${webhook.name} send successfully`);
            }

            //Update the last triggered timestamp
            await dbInstance.query(
                'UPDATE webhooks SET last_triggered = NOW() WHERE id = $1',
                [webhook.id]
            );

            await addWebhookDelivery({
                webhookId: webhook.id,
                name: webhook.name,
                destination: webhook.url,
                webhookType: webhook.webhook_type || 'generic',
                eventType: data.event || webhook.event_type || webhook.trigger_type,
                ok: true,
                status: response?.status || null,
                retryOnFailure: Boolean(webhook.retry_on_failure),
                maxRetries: webhook.max_retries || 0,
            });

            return true;
        } catch (error) {
            console.error(`[WEBHOOK] Error triggering webhook ${webhook.name}:`, error.message);
            if (error.response) {
                console.error(`[WEBHOOK] Response status: ${error.response.status}`);
                console.error(`[WEBHOOK] Response data:`, error.response.data);
            }
            this.lastError = {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            };
            await addWebhookDelivery({
                webhookId: webhook.id,
                name: webhook.name,
                destination: webhook.url,
                webhookType: webhook.webhook_type || 'generic',
                eventType: data.event || webhook.event_type || webhook.trigger_type,
                ok: false,
                status: error.response?.status || null,
                retryOnFailure: Boolean(webhook.retry_on_failure),
                maxRetries: webhook.max_retries || 0,
                error: error.response?.data?.message || error.response?.data?.error || error.message,
            });
            return false;
        }
    }

    shouldEmitPlaybackWebhook(eventType, data = {}) {
        if (!this.playbackEventGate) {
            this.playbackEventGate = createPlaybackEventGate();
        }
        return this.playbackEventGate.shouldEmit(eventType, data);
    }

    shouldCoalesceWebhook(webhook, eventType) {
        const coalesced = new Set([
            "task_started",
            "task_completed",
            "task_failed",
            "download_queue_refreshed",
            "calendar_refreshed",
            "invite_links_refreshed",
        ]);
        if (!coalesced.has(eventType)) return false;
        return webhook.webhook_type === "discord"
            || webhook.webhook_type === "gotify"
            || webhook.webhook_type === "ntfy"
            || webhook.webhook_type === "telegram"
            || webhook.webhook_type === "pushover"
            || String(webhook.url || "").includes("discord.com/api/webhooks");
    }

    pickCoalescedEvent(events = []) {
        if (events.includes("task_failed")) return "task_failed";
        if (events.includes("task_completed")) return "task_completed";
        const refreshed = events.find((event) => String(event).endsWith("_refreshed"));
        if (refreshed) return refreshed;
        return events[events.length - 1];
    }

    enqueueCoalescedWebhook(webhook, eventType, data = {}) {
        if (!this.coalescedWebhooks) this.coalescedWebhooks = new Map();
        const family = data.taskKey || data.taskName || eventType;
        const key = `${webhook.url}::${family}`;
        const existing = this.coalescedWebhooks.get(key);
        if (existing?.timer) clearTimeout(existing.timer);

        const events = [...(existing?.events || []), eventType];
        const webhooksByEvent = { ...(existing?.webhooksByEvent || {}), [eventType]: webhook };
        const merged = {
            ...(existing?.data || {}),
            ...data,
            coalescedEvents: events,
            event: this.pickCoalescedEvent(events),
            startedAt: existing?.data?.startedAt || Date.now(),
            clientCount: data.clientCount ?? existing?.data?.clientCount,
            releaseCount: data.releaseCount ?? existing?.data?.releaseCount,
            inviteCount: data.inviteCount ?? existing?.data?.inviteCount,
            sourceCount: data.sourceCount ?? existing?.data?.sourceCount,
            downloadActiveCount: eventType === "download_queue_refreshed" && data.activeCount != null
                ? data.activeCount
                : existing?.data?.downloadActiveCount,
            inviteActiveCount: eventType === "invite_links_refreshed" && data.activeCount != null
                ? data.activeCount
                : existing?.data?.inviteActiveCount,
        };
        if (eventType === "task_completed" || eventType === "task_failed") {
            merged.durationMs = Date.now() - merged.startedAt;
        }

        const delay = eventType === "task_completed" || eventType === "task_failed" ? 80 : 400;
        const entry = {
            events,
            data: merged,
            webhooksByEvent,
            timer: null,
        };
        entry.timer = setTimeout(() => {
            const current = this.coalescedWebhooks.get(key);
            if (current !== entry) return;
            this.coalescedWebhooks.delete(key);
            const displayEvent = current.data.event;
            const target = current.webhooksByEvent[displayEvent] || webhook;
            this.executeWebhook(target, current.data).catch((error) => {
                console.error("[WEBHOOK] Coalesced webhook failed:", error.message);
            });
        }, delay);

        this.coalescedWebhooks.set(key, entry);
        return true;
    }

    async flushCoalescedWebhooks() {
        if (!this.coalescedWebhooks?.size) return true;
        const entries = [...this.coalescedWebhooks.values()];
        this.coalescedWebhooks.clear();
        const results = await Promise.all(entries.map((entry) => {
            if (entry.timer) clearTimeout(entry.timer);
            const displayEvent = entry.data.event;
            const target = entry.webhooksByEvent[displayEvent] || Object.values(entry.webhooksByEvent)[0];
            if (!target) return true;
            return this.executeWebhook(target, entry.data);
        }));
        return results.every(Boolean);
    }

    getDefaultTitle(data = {}) {
        if (data.event === 'wrapped_recap') {
            return data.title || 'Wrapped recap';
        }

        if (data.event === 'playback_digest') {
            return data.integrationEvent || 'Overnight playback digest';
        }

        if (data.event === 'playback_started') {
            return `${data.UserName || data.userData?.username || 'A user'} started playback`;
        }

        if (data.event === 'playback_ended') {
            return `${data.UserName || data.userData?.username || 'A user'} stopped playback`;
        }

        if (data.event === 'download_added' || data.event === 'download_started' || data.event === 'download_completed' || data.event === 'download_failed') {
            return data.integrationEvent || data.itemName || 'Download update';
        }

        if (data.taskName) {
            return data.taskName;
        }

        if (data.event === 'download_queue_refreshed') {
            return 'Download queue';
        }

        if (data.event === 'calendar_refreshed') {
            return 'Calendar';
        }

        if (data.event === 'invite_links_refreshed') {
            return 'Invites';
        }

        if (data.count) {
            return 'Library sync';
        }

        if (data.integrationEvent) {
            return data.integrationEvent.replace(/\b\w/g, (char) => char.toUpperCase());
        }

        return 'JellyGlance';
    }

    getDefaultMessage(data = {}) {
        if (data.event === 'playback_digest') {
            return data.message || `${data.count || 0} playback events during quiet hours.`;
        }

        if (data.event === 'playback_started' || data.event === 'playback_ended') {
            const action = data.event === 'playback_started' ? 'started' : 'stopped';
            const itemName = data.ItemName || data.mediaInfo?.mediaName || 'media';
            const detail = data.PlayMethod ? ` via ${data.PlayMethod}` : '';
            return `${data.UserName || data.userData?.username || 'A user'} ${action} ${itemName}${detail}.`;
        }

        if (data.event === 'download_added' || data.event === 'download_started' || data.event === 'download_completed' || data.event === 'download_failed') {
            return data.message || data.itemName || data.item?.name || `${data.event} fired.`;
        }

        const stats = [
            data.clientCount != null ? `${data.clientCount} client${Number(data.clientCount) === 1 ? '' : 's'}` : null,
            data.activeCount != null ? `${data.activeCount} active` : null,
            data.releaseCount != null ? `${data.releaseCount} release${Number(data.releaseCount) === 1 ? '' : 's'}` : null,
            data.inviteCount != null ? `${data.inviteCount} invite${Number(data.inviteCount) === 1 ? '' : 's'}` : null,
            data.count != null ? `${data.count} item${Number(data.count) === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' · ');

        if (data.event === 'task_started') {
            return stats ? `Started · ${stats}` : 'Started';
        }
        if (data.event === 'task_completed') {
            return stats ? `Completed · ${stats}` : 'Completed';
        }
        if (data.event === 'task_failed') {
            return data.error ? `Failed · ${data.error}` : 'Failed';
        }
        if (String(data.event || '').endsWith('_refreshed')) {
            return stats ? `Synced · ${stats}` : 'Synced';
        }

        if (data.count) {
            return `${data.count} new library item${Number(data.count) === 1 ? '' : 's'} synced.`;
        }

        if (data.integrationEvent) {
            return data.message || stats || `${data.integrationEvent} fired.`;
        }

        return data.message || `${data.event || 'Event'} fired at ${data.triggeredAt || new Date().toISOString()}`;
    }

    compileTemplate(template, data) {
        if (typeof template === 'object') {
            return Object.keys(template).reduce((result, key) => {
                if (template[key] !== undefined) {
                    result[key] = this.compileTemplate(template[key], data);
                }
                return result;
            }, {});
        } else if (typeof template === 'string') {
            // Replace {{variable}} with the corresponding value from data
            return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
                const keys = path.trim().split('.');
                let value = data;

                for (const key of keys) {
                    if (value === undefined) return match;
                    value = value[key];
                }

                return value !== undefined ? value : match;
            });
        }

        return template;
    }

    async triggerEvent(eventType, eventData = {}) {
        try {
            const webhooks = this.eventWebhooks?.[eventType] || [];
            
            if (webhooks.length === 0) {
                console.log(`[WEBHOOK] No webhooks registered for event: ${eventType}`);
                return;
            }
            
            console.log(`[WEBHOOK] Triggering ${webhooks.length} webhooks for event: ${eventType}`);
            
            const promises = webhooks.map(webhook => {
                return this.webhookManager.executeWebhook(webhook, {
                    ...eventData,
                    event: eventType,
                    triggeredAt: new Date().toISOString()
                });
            });
            
            await Promise.all(promises);
        } catch (error) {
            console.error(`[WEBHOOK] Error triggering webhooks for event ${eventType}:`, error);
        }
    }

    emitEvent(eventType, data) {
        this.eventEmitter.emit(eventType, data);
    }

    async getTopWatchedContent(contentType, period = 'month', limit = 5) {
        // Calculate period start date
        const today = new Date();
        let startDate;

        if (period === 'month') {
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        } else if (period === 'week') {
            const day = today.getDay();
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day - 7);
        } else {
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        }

        const formattedStartDate = startDate.toISOString().split('T')[0];

        // SQL query to get top watched content
        let query;
        if (contentType === 'movie') {
            query = `
                SELECT
                    "NowPlayingItemName" as title,
                    COUNT(DISTINCT "UserId") as unique_viewers,
                    SUM("PlaybackDuration") / 60000 as total_minutes
                FROM jf_playback_activity
                WHERE "ActivityDateInserted" >= $1
                  AND "NowPlayingItemName" IS NOT NULL
                  AND "SeriesName" IS NULL
                GROUP BY "NowPlayingItemName", "NowPlayingItemId"
                ORDER BY total_minutes DESC
                LIMIT $2
            `;
        } else if (contentType === 'series') {
            query = `
                SELECT
                    "SeriesName" as title,
                    COUNT(DISTINCT "UserId") as unique_viewers,
                    SUM("PlaybackDuration") / 60000 as total_minutes
                FROM jf_playback_activity
                WHERE "ActivityDateInserted" >= $1
                  AND "SeriesName" IS NOT NULL
                GROUP BY "SeriesName"
                ORDER BY total_minutes DESC
                LIMIT $2
            `;
        }

        try {
            const result = await dbInstance.query(query, [formattedStartDate, limit]);
            return result.rows || [];
        } catch (error) {
            console.error(`[WEBHOOK] SQL ERROR (${contentType}):`, error.message);
            return [];
        }
    }

    async getMonthlySummaryData() {
        try {
            // Get the top watched movies and series
            const topMovies = await this.getTopWatchedContent('movie', 'month', 5);
            const topSeries = await this.getTopWatchedContent('series', 'month', 5);

            const prevMonth = new Date();
            prevMonth.setMonth(prevMonth.getMonth() - 1);
            const prevMonthStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
            const prevMonthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0);

            const formattedStart = prevMonthStart.toISOString().split('T')[0];
            const formattedEnd = prevMonthEnd.toISOString().split('T')[0];

            // Get general statistics
            const statsQuery = `
                SELECT
                    COUNT(DISTINCT "UserId") as active_users,
                    COUNT(*) as total_plays,
                    SUM("PlaybackDuration") / 3600000 as total_hours
                FROM jf_playback_activity
                WHERE "ActivityDateInserted" BETWEEN $1 AND $2
            `;

            const statsResult = await dbInstance.query(statsQuery, [formattedStart, formattedEnd]);
            const generalStats = statsResult.rows[0] || {
                active_users: 0,
                total_plays: 0,
                total_hours: 0
            };

            return {
                period: {
                    start: formattedStart,
                    end: formattedEnd,
                    name: prevMonth.toLocaleString('fr-FR', { month: 'long', year: 'numeric' })
                },
                topMovies,
                topSeries,
                stats: generalStats
            };
        } catch (error) {
            console.error("[WEBHOOK] Error while getting data:", error.message);
            throw error;
        }
    }

        async triggerMonthlySummaryWebhook(webhookId) {
        try {
            // Get the webhook details
            const result = await dbInstance.query(
                'SELECT * FROM webhooks WHERE id = $1 AND enabled = true',
                [webhookId]
            );

            if (result.rows.length === 0) {
                console.error(`[WEBHOOK] Webhook ID ${sanitizeForLog(webhookId)} not found or disable`);
                return false;
            }

            const webhook = result.rows[0];

            // Generate the monthly summary data
            try {
                const data = await this.getMonthlySummaryData();

                const moviesFields = data.topMovies.map((movie, index) => ({
                    name: `${index + 1}. ${movie.title}`,
                    value: `${Math.round(movie.total_minutes)} minutes • ${movie.unique_viewers} viewers`,
                    inline: false
                }));

                const seriesFields = data.topSeries.map((series, index) => ({
                    name: `${index + 1}. ${series.title}`,
                    value: `${Math.round(series.total_minutes)} minutes • ${series.unique_viewers} viewers`,
                    inline: false
                }));

                const monthlyPayload = {
                    content: `📊 **Monthly Report - ${data.period.name}**`,
                    embeds: [
                        {
                            title: "🎬 Most Watched Movies",
                            color: 15844367,
                            fields: moviesFields.length > 0 ? moviesFields : [{ name: "No data", value: "No movies watch this month" }]
                        },
                        {
                            title: "📺 Most Watched Series",
                            color: 5793266,
                            fields: seriesFields.length > 0 ? seriesFields : [{ name: "No data", value: "No Series watch this month" }]
                        },
                        {
                            title: "📈 General Statistics",
                            color: 5763719,
                            fields: [
                                {
                                    name: "Active Users",
                                    value: `${data.stats.active_users || 0}`,
                                    inline: true
                                },
                                {
                                    name: "Total Plays",
                                    value: `${data.stats.total_plays || 0}`,
                                    inline: true
                                },
                                {
                                    name: "Total Hours Watched",
                                    value: `${Math.round(data.stats.total_hours || 0)}`,
                                    inline: true
                                }
                            ],
                            footer: {
                                text: `Period: from ${new Date(data.period.start).toLocaleDateString('en-US')} to ${new Date(data.period.end).toLocaleDateString('en-US')}`
                            }
                        }
                    ]
                };

                // Send the webhook
                await axios({
                    method: webhook.method || 'POST',
                    url: webhook.url,
                    headers: { 'Content-Type': 'application/json' },
                    data: monthlyPayload,
                    timeout: 10000
                });

                console.log(`[WEBHOOK] Monthly report webhook ${webhook.name} sent successfully`);

                // Update the last triggered timestamp
                await dbInstance.query(
                    'UPDATE webhooks SET last_triggered = NOW() WHERE id = $1',
                    [webhook.id]
                );

                return true;
            } catch (dataError) {
                console.error(`[WEBHOOK] Error while preparing the data:`, dataError.message);
                return false;
            }
        } catch (error) {
            console.error(`[WEBHOOK] Error while sending the monthly report:`, error.message);
            return false;
        }
    }

    async executeDiscordWebhook(webhook, data) {
        try {
            console.log(`Execution of discord webhook: ${webhook.name}`);

            const response = await axios.post(webhook.url, data, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[WEBHOOK] Discord response: ${response.status}`);
            await addWebhookDelivery({
                webhookId: webhook.id,
                name: webhook.name,
                destination: webhook.url,
                webhookType: webhook.webhook_type || 'discord',
                eventType: data.event || webhook.event_type || 'test',
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                retryOnFailure: Boolean(webhook.retry_on_failure),
                maxRetries: webhook.max_retries || 0,
            });
            return response.status >= 200 && response.status < 300;
        } catch (error) {
            console.error(`[WEBHOOK] Error with Discord webhook ${webhook.name}:`, error.message);
            if (error.response) {
                console.error('[WEBHOOK] Response status:', error.response.status);
                console.error('[WEBHOOK] Response data:', error.response.data);
            }
            await addWebhookDelivery({
                webhookId: webhook.id,
                name: webhook.name,
                destination: webhook.url,
                webhookType: webhook.webhook_type || 'discord',
                eventType: data.event || webhook.event_type || 'test',
                ok: false,
                status: error.response?.status || null,
                retryOnFailure: Boolean(webhook.retry_on_failure),
                maxRetries: webhook.max_retries || 0,
                error: error.response?.data?.message || error.response?.data?.error || error.message,
            });
            return false;
        }
    }
}

module.exports = WebhookManager;
