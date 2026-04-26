import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    handleUserResource,
    handleMemberResource,
    handleTierResource,
    handleOfferResource,
    handleNewsletterResource,
    handlePostResource,
    handleBlogInfoResource
} from './resources';
import { registerPostTools } from "./tools/posts";
import { registerMemberTools } from "./tools/members";
import { registerUserTools } from "./tools/users";
import { registerTagTools } from "./tools/tags";
import { registerTierTools } from "./tools/tiers";
import { registerOfferTools } from "./tools/offers";
import { registerNewsletterTools } from "./tools/newsletters";
import { registerInviteTools } from "./tools/invites";
import { registerRoleTools } from "./tools/roles";
import { registerWebhookTools } from "./tools/webhooks";
import { registerPrompts } from "./prompts";

export function createServer(): McpServer {
    const server = new McpServer({
        name: "ghost-mcp-ts",
        version: "1.0.0", // TODO: Get version from package.json
    }, {
        capabilities: {
            resources: {}, // Capabilities will be enabled as handlers are registered
            tools: {},
            prompts: {},
            logging: {} // Enable logging capability
        }
    });

    // Register resource handlers
    server.resource("user", new ResourceTemplate("user://{user_id}", { list: undefined }), handleUserResource);
    server.resource("member", new ResourceTemplate("member://{member_id}", { list: undefined }), handleMemberResource);
    server.resource("tier", new ResourceTemplate("tier://{tier_id}", { list: undefined }), handleTierResource);
    server.resource("offer", new ResourceTemplate("offer://{offer_id}", { list: undefined }), handleOfferResource);
    server.resource("newsletter", new ResourceTemplate("newsletter://{newsletter_id}", { list: undefined }), handleNewsletterResource);
    server.resource("post", new ResourceTemplate("post://{post_id}", { list: undefined }), handlePostResource);
    server.resource("blog-info", "blog://info", handleBlogInfoResource);

    // Register tools
    registerPostTools(server);
    registerMemberTools(server);
    registerUserTools(server);
    registerTagTools(server);
    registerTierTools(server);
    registerOfferTools(server);
    registerNewsletterTools(server);
    registerInviteTools(server);
    registerRoleTools(server);
    registerWebhookTools(server);

    // Register prompts
    registerPrompts(server);

    return server;
}
