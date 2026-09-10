// suhail-api-worker.js

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

/* =========================================================
   COMMON HELPERS
========================================================= */

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* =========================================================
   SHA-256
========================================================= */

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* =========================================================
   DUFFEL
========================================================= */

async function duffel(
  path,
  method = "GET",
  body,
  token
) {
  token = String(token || "").trim();

  if (!token) {
    throw new Error(
      "DUFFEL_TOKEN is not configured"
    );
  }

  const response = await fetch(
    "https://api.duffel.com" + path,
    {
      method,

      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        "Content-Type": "application/json",
      },

      body: body
        ? JSON.stringify(body)
        : undefined,
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      data?.errors?.[0]?.message ||
      data?.error ||
      `Duffel ${response.status}`
    );
  }

  return data;
}

/* =========================================================
   DUFFEL FLIGHTS
========================================================= */

async function flights(params, token) {
  const origin = cleanCode(params.origin);
  const destination = cleanCode(
    params.destination
  );

  const departureDate = String(
    params.departureDate || ""
  );

  if (
    !origin ||
    !destination ||
    !validDate(departureDate)
  ) {
    throw new Error(
      "origin, destination and a valid departureDate are required"
    );
  }

  const adults = clamp(
    Number(params.adults || 1),
    1,
    9
  );

  const allowedCabins = [
    "economy",
    "premium_economy",
    "business",
    "first",
  ];

  const cabin = allowedCabins.includes(
    params.cabin
  )
    ? params.cabin
    : "economy";

  const slices = [
    {
      origin,
      destination,
      departure_date: departureDate,
    },
  ];

  if (
    params.returnDate &&
    validDate(params.returnDate)
  ) {
    slices.push({
      origin: destination,
      destination: origin,
      departure_date: params.returnDate,
    });
  }

  const body = {
    data: {
      cabin_class: cabin,

      slices,

      passengers: Array.from(
        {
          length: adults,
        },
        () => ({
          type: "adult",
        })
      ),
    },
  };

  const data = await duffel(
    "/air/offer_requests?return_offers=true&view=offers",
    "POST",
    body,
    token
  );

  return {
    provider: "duffel",
    offers: data?.data?.offers || [],
    request: data?.data?.id || null,
    liveMode: !!data?.data?.live_mode,
  };
}

/* =========================================================
   HOTELBEDS mTLS
========================================================= */

async function hotelbedsRequest(
  path,
  method,
  body,
  env
) {
  const apiKey = String(
    env?.HOTELBEDS_API_KEY || ""
  ).trim();

  const secret = String(
    env?.HOTELBEDS_SECRET || ""
  ).trim();

  if (!apiKey) {
    throw new Error(
      "HOTELBEDS_API_KEY is not configured"
    );
  }

  if (!secret) {
    throw new Error(
      "HOTELBEDS_SECRET is not configured"
    );
  }

  if (
    !env?.HOTELBEDS_MTLS ||
    typeof env.HOTELBEDS_MTLS.fetch !== "function"
  ) {
    throw new Error(
      "HOTELBEDS_MTLS certificate binding is not configured"
    );
  }

  const timestamp = Math.floor(
    Date.now() / 1000
  );

  const signature = await sha256Hex(
    apiKey + secret + timestamp
  );

  const url =
    "https://api-mtls.test.hotelbeds.com" +
    path;

  /*
    IMPORTANT:
    We intentionally use HOTELBEDS_MTLS.fetch()
    instead of the normal global fetch().

    Cloudflare will present the client certificate
    automatically during the TLS handshake.
  */

  const response =
    await env.HOTELBEDS_MTLS.fetch(
      url,
      {
        method,

        headers: {
          "Api-key": apiKey,
          "X-Signature": signature,
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "Content-Type": "application/json",
        },

        body: body
          ? JSON.stringify(body)
          : undefined,
      }
    );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text,
    };
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      data?.errors?.[0]?.text ||
      data?.errors?.[0]?.message ||
      data?.message ||
      data?.raw ||
      `Hotelbeds ${response.status}`;

    throw new Error(
      `Hotelbeds ${response.status}: ${message}`
    );
  }

  return data;
}

/* =========================================================
   HOTELBEDS TEST HOTEL CODES

   These are Hotelbeds test/example hotel codes.
   First we use them only to verify that mTLS works.
========================================================= */

const HOTEL_TEST_CODES = [
  3424,
  168,
];

/* =========================================================
   HOTELBEDS AVAILABILITY
========================================================= */

async function hotelbedsAvailability(
  params,
  env
) {
  const checkIn = String(
    params.checkIn || ""
  );

  const checkOut = String(
    params.checkOut || ""
  );

  if (
    !validDate(checkIn) ||
    !validDate(checkOut)
  ) {
    throw new Error(
      "checkIn and checkOut must be YYYY-MM-DD"
    );
  }

  if (
    new Date(checkOut) <=
    new Date(checkIn)
  ) {
    throw new Error(
      "checkOut must be after checkIn"
    );
  }

  const adults = clamp(
    Number(params.adults || 2),
    1,
    9
  );

  const rooms = clamp(
    Number(params.rooms || 1),
    1,
    10
  );

  const body = {
    stay: {
      checkIn,
      checkOut,
    },

    occupancies: [
      {
        rooms,
        adults,
        children: 0,
      },
    ],

    hotels: {
      hotel: HOTEL_TEST_CODES,
    },

    sourceMarket: "OM",

    dailyRate: true,
  };

  return await hotelbedsRequest(
    "/hotel-api/1.0/hotels",
    "POST",
    body,
    env
  );
}

/* =========================================================
   HOTELBEDS -> SUHAIL FORMAT
========================================================= */

function normalizeHotelbedsResults(
  data,
  params
) {
  const hotels =
    data?.hotels?.hotels ||
    data?.hotels?.hotel ||
    [];

  if (!Array.isArray(hotels)) {
    return [];
  }

  const checkIn = new Date(
    params.checkIn
  );

  const checkOut = new Date(
    params.checkOut
  );

  const nights = Math.max(
    1,
    Math.round(
      (checkOut - checkIn) /
      86400000
    )
  );

  const city = String(
    params.city || "muscat"
  );

  const results = [];

  for (const hotel of hotels) {
    const hotelRooms =
      Array.isArray(hotel.rooms)
        ? hotel.rooms
        : [];

    let cheapestRate = null;
    let cheapestAmount = Infinity;

    for (const room of hotelRooms) {
      const rates =
        Array.isArray(room.rates)
          ? room.rates
          : [];

      for (const rate of rates) {
        const amount = Number(
          rate.net ||
          rate.sellingRate ||
          rate.publicRate ||
          0
        );

        if (
          Number.isFinite(amount) &&
          amount > 0 &&
          amount < cheapestAmount
        ) {
          cheapestAmount = amount;

          cheapestRate = {
            ...rate,
            room,
          };
        }
      }
    }

    if (!cheapestRate) {
      continue;
    }

    const currency =
      cheapestRate.currency ||
      data?.auditData?.currency ||
      "EUR";

    const amountPerNight =
      cheapestAmount / nights;

    const categoryCode = String(
      hotel.categoryCode || ""
    );

    let stars = Number(
      categoryCode.replace(
        /[^0-9]/g,
        ""
      )
    );

    if (
      !Number.isFinite(stars) ||
      stars < 1 ||
      stars > 5
    ) {
      stars = 3;
    }

    const cancellationPolicies =
      Array.isArray(
        cheapestRate
          .cancellationPolicies
      )
        ? cheapestRate
            .cancellationPolicies
        : [];

    const freeCancel =
      cancellationPolicies.length === 0 ||
      cancellationPolicies.every(
        (policy) =>
          Number(
            policy.amount || 0
          ) === 0
      );

    results.push({
      id:
        "hotelbeds-" +
        String(
          hotel.code ||
          results.length
        ),

      accommodation: {
        id: String(
          hotel.code || ""
        ),

        name:
          hotel.name ||
          "Hotelbeds Hotel",

        rating: stars,

        review_score: 0,
        review_count: 0,

        location: {
          address: {
            city_name:
              hotel.destinationName ||
              hotel.city ||
              city,
          },
        },

        photos: [],
      },

      cheapest_rate_total_amount:
        String(cheapestAmount),

      cheapest_rate_amount_per_night:
        String(amountPerNight),

      cheapest_rate_currency:
        currency,

      cheapest_rate_public_currency:
        currency,

      rooms: [
        {
          rates: [
            {
              cancellation_timeline:
                cancellationPolicies,

              rateKey:
                cheapestRate.rateKey ||
                null,

              rateType:
                cheapestRate.rateType ||
                null,

              boardName:
                cheapestRate.boardName ||
                "",

              roomName:
                cheapestRate.roomName ||
                cheapestRate.room?.name ||
                "",

              net:
                cheapestAmount,

              currency,
            },
          ],
        },
      ],

      hotelbeds: {
        hotelCode:
          hotel.code || null,

        destinationCode:
          hotel.destinationCode ||
          null,

        rateKey:
          cheapestRate.rateKey ||
          null,

        rateType:
          cheapestRate.rateType ||
          null,

        boardName:
          cheapestRate.boardName ||
          null,

        roomName:
          cheapestRate.roomName ||
          cheapestRate.room?.name ||
          null,

        freeCancel,
        nights,
        amountPerNight,
      },
    });
  }

  return results;
}

/* =========================================================
   STAYS
========================================================= */

async function stays(params, env) {
  const results =
    await hotelbedsAvailability(
      params,
      env
    );

  const normalized =
    normalizeHotelbedsResults(
      results,
      params
    );

  return {
    provider: "hotelbeds",

    results: normalized,

    searchId:
      results?.auditData?.processTime ||
      null,

    testMode: true,

    mtls: true,

    rawCount:
      results?.hotels?.total ??
      normalized.length,
  };
}

/* =========================================================
   HEALTH CHECK
========================================================= */

async function health(env) {
  const duffelConfigured =
    !!String(
      env?.DUFFEL_TOKEN || ""
    ).trim();

  const hotelKeyConfigured =
    !!String(
      env?.HOTELBEDS_API_KEY || ""
    ).trim();

  const hotelSecretConfigured =
    !!String(
      env?.HOTELBEDS_SECRET || ""
    ).trim();

  const mtlsConfigured =
    !!env?.HOTELBEDS_MTLS &&
    typeof env.HOTELBEDS_MTLS.fetch ===
      "function";

  return {
    ok:
      duffelConfigured &&
      hotelKeyConfigured &&
      hotelSecretConfigured &&
      mtlsConfigured,

    flights: {
      provider: "duffel",
      configured:
        duffelConfigured,
    },

    hotels: {
      provider: "hotelbeds",

      configured:
        hotelKeyConfigured &&
        hotelSecretConfigured,

      mtlsConfigured,

      environment: "test",

      endpoint:
        "api-mtls.test.hotelbeds.com",
    },
  };
}

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(request, env) {
    if (
      request.method === "OPTIONS"
    ) {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(
      request.url
    );

    try {
      /*
        Friendly root status page
      */

      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          name: "Suhail API",
          ok: true,
          message:
            "Suhail API is running",
          health:
            "/api/health",
        });
      }

      /*
        Health
      */

      if (
        url.pathname ===
          "/api/health" &&
        request.method === "GET"
      ) {
        return json(
          await health(env)
        );
      }

      /*
        All remaining endpoints
        require POST.
      */

      if (
        request.method !== "POST"
      ) {
        return json(
          {
            error:
              "Method not allowed",
          },
          405
        );
      }

      let params = {};

      try {
        params =
          await request.json();
      } catch {
        return json(
          {
            error:
              "Invalid JSON body",
          },
          400
        );
      }

      /*
        Flights
      */

      if (
        url.pathname ===
        "/api/flights/search"
      ) {
        return json(
          await flights(
            params,
            env?.DUFFEL_TOKEN
          )
        );
      }

      /*
        Hotels
      */

      if (
        url.pathname ===
        "/api/stays/search"
      ) {
        return json(
          await stays(
            params,
            env
          )
        );
      }

      return json(
        {
          error: "Not found",
        },
        404
      );
    } catch (error) {
      console.error(
        "Suhail API error:",
        error
      );

      return json(
        {
          error:
            error?.message ||
            "Server error",
        },
        400
      );
    }
  },
};
