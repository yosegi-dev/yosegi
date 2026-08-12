import {
	type ComponentRegistry,
	componentRegistrySchema,
	parseScreenDefinition,
	parseScreenOperations,
	screenIdSchema,
	screenNodeSchema,
} from "@yosegi/core";
import type { Composer } from "@yosegi/core/app";
import {
	type ActorContext,
	agentActor,
	buildImplementationContext,
	systemActor,
} from "@yosegi/core/app";
import { Hono } from "hono";
import { z } from "zod";
import { toErrorResponse } from "../error-response.ts";

const createScreenBodySchema = z.object({
	id: screenIdSchema,
	name: z.string().min(1),
	status: z.enum(["draft", "published"]).optional(),
	root: screenNodeSchema,
});

const operationsBodySchema = z.object({
	baseRevision: z.number().int().nonnegative(),
	operations: z.array(z.unknown()),
});

const replaceScreenBodySchema = z.object({
	baseRevision: z.number().int().nonnegative(),
	screen: z.unknown(),
});

// Determines the request's acting principal. For the MVP, a simple switch based on the
// X-Composer-Actor header. In production, this is the swap-in point for deriving
// permissions from a JWT / session.
function resolveActor(header: string | undefined): ActorContext {
	return header === "agent" ? agentActor() : systemActor();
}

export type HttpAppOptions = {
	// A hook that persists a caller-assembled Registry to data/registry.json.
	persistRegistry?: (registry: ComponentRegistry) => Promise<void>;
};

// The HTTP API for agents. Every handler calls a service through the Composer.
export function createHttpApp(
	composer: Composer,
	options: HttpAppOptions = {},
): Hono {
	const app = new Hono();

	app.onError((error, c) => {
		const { status, body } = toErrorResponse(error);
		return c.json(body, status as 400);
	});

	app.get("/api/health", (c) => c.json({ ok: true }));

	app.get("/api/registry", (c) =>
		c.json({ version: composer.components.getRegistryVersion() }),
	);

	// Push a caller-assembled Registry, so server-side validation lines up with the same
	// component definitions the caller is using. Pass ?persist=true to save it to data.
	app.put("/api/registry", async (c) => {
		const registry = componentRegistrySchema.parse(await c.req.json());
		composer.components.replaceRegistry(registry);
		if (c.req.query("persist") === "true" && options.persistRegistry) {
			await options.persistRegistry(registry);
		}
		return c.json({
			version: registry.version,
			count: registry.components.length,
		});
	});

	// Components
	app.get("/api/components", (c) => {
		const query = c.req.query("query");
		const category = c.req.query("category");
		const components =
			query || category
				? composer.components.searchComponents({ query, category })
				: composer.components.listComponents();
		return c.json({
			components,
			categories: composer.components.listCategories(),
		});
	});

	app.get("/api/components/:componentId", (c) => {
		// A not-found case has requireComponent throw COMPONENT_NOT_FOUND, and onError →
		// toErrorResponse maps it to 404 (consolidated through the same path as other routes).
		const component = composer.components.requireComponent(
			c.req.param("componentId"),
		);
		return c.json(component);
	});

	// Screens. listScreens already returns { screens, warnings }, so the body is
	// passed through — wrapping it again would nest "screens" twice.
	app.get("/api/screens", async (c) =>
		c.json(await composer.screens.listScreens()),
	);

	app.get("/api/screens/:screenId", async (c) => {
		const screen = await composer.screens.getScreen(c.req.param("screenId"));
		return c.json(screen);
	});

	app.post("/api/screens", async (c) => {
		const body = createScreenBodySchema.parse(await c.req.json());
		const result = await composer.screens.createScreen(
			body,
			resolveActor(c.req.header("x-composer-actor")),
		);
		return c.json(result, 201);
	});

	// A full screen replacement (optimistic locking).
	app.patch("/api/screens/:screenId", async (c) => {
		// As with other routes, validate the body with zod so a malformed shape falls
		// through to 400 (avoiding a TypeError→500 from accessing raw.baseRevision directly).
		const body = replaceScreenBodySchema.parse(await c.req.json());
		const screen = parseScreenDefinition(body.screen);
		const result = await composer.screens.updateScreen(
			c.req.param("screenId"),
			screen,
			body.baseRevision,
			resolveActor(c.req.header("x-composer-actor")),
		);
		return c.json(result);
	});

	app.delete("/api/screens/:screenId", async (c) => {
		await composer.screens.deleteScreen(
			c.req.param("screenId"),
			resolveActor(c.req.header("x-composer-actor")),
		);
		return c.body(null, 204);
	});

	// A partial update via Operation (the recommended path).
	app.post("/api/screens/:screenId/operations", async (c) => {
		const body = operationsBodySchema.parse(await c.req.json());
		const operations = parseScreenOperations(body.operations);
		const result = await composer.screens.applyOperations(
			c.req.param("screenId"),
			operations,
			body.baseRevision,
			resolveActor(c.req.header("x-composer-actor")),
		);
		return c.json(result);
	});

	app.post("/api/screens/:screenId/duplicate", async (c) => {
		const body = z
			.object({ newId: screenIdSchema, newName: z.string().min(1) })
			.parse(await c.req.json());
		const result = await composer.screens.duplicateScreen(
			c.req.param("screenId"),
			body.newId,
			body.newName,
			resolveActor(c.req.header("x-composer-actor")),
		);
		return c.json(result, 201);
	});

	app.post("/api/screens/:screenId/validate", async (c) =>
		c.json(await composer.screens.validate(c.req.param("screenId"))),
	);

	// The implementation context for agents.
	app.get("/api/screens/:screenId/implementation-context", async (c) => {
		const screen = await composer.screens.getScreen(c.req.param("screenId"));
		return c.json(buildImplementationContext(screen, composer.components));
	});

	return app;
}
