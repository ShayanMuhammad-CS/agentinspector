import { getBus } from "../../../dist/bus.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const bus = getBus();
  const encoder = new TextEncoder();

  let onEvents = null;
  let onReset = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send("reset", bus.snapshot());
      onEvents = (events) => send("events", events);
      onReset = (snap) => send("reset", snap);
      bus.on("events", onEvents);
      bus.on("reset", onReset);

      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15000);

      controller._ping = ping;
    },
    cancel() {
      if (onEvents) bus.off("events", onEvents);
      if (onReset) bus.off("reset", onReset);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
