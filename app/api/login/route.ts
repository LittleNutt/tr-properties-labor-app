import {
  assertPasswordConfigured,
  createInternalSessionCookie,
  isValidInternalPassword,
} from "../../internal-auth";

export async function POST(request: Request) {
  try {
    assertPasswordConfigured();
    const body = (await request.json().catch(() => null)) as
      | { password?: string }
      | null;
    const password = body?.password ?? "";

    if (!(await isValidInternalPassword(password))) {
      return Response.json(
        { ok: false, error: "Incorrect access code." },
        { status: 401 },
      );
    }

    return Response.json(
      { ok: true },
      {
        headers: {
          "Set-Cookie": await createInternalSessionCookie(),
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
