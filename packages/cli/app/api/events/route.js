import { getBus } from "../../../dist/bus.js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const bus = getBus();
  return NextResponse.json(bus.snapshot());
}
