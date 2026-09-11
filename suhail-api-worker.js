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
   HELPERS
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
  return Math.max(min, Math.min(max, Number(value)));
}

function nightsBetween(checkIn, checkOut) {
  const start = new Date(checkIn);
  const end = new Date(checkOut);

  return Math.max(
    1,
    Math.round((end - start) / 86400000)
  );
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* =========================================================
   DUFFEL
========================================================= */

async function duffel(path, method = "GET", body, token) {
  token = String(token || "").trim();

  if (!token) {
    throw new Error("DUFFEL_TOKEN is not configured");
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
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
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
   FLIGHTS
========================================================= */

async function flights(params, token) {
  const origin = cleanCode(params.origin);
  const destination = cleanCode(params.destination);

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
    params.adults || 1,
    1,
    9
  );

  const allowedCabins = [
    "economy",
    "premium_economy",
    "business",
    "first",
  ];

  const cabin = allowedCabins.includes(params.cabin)
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
        { length: adults },
        () => ({ type: "adult" })
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

  const timestamp = Math.floor(Date.now() / 1000);

  const signature = await sha256Hex(
    apiKey + secret + timestamp
  );

  const response = await env.HOTELBEDS_MTLS.fetch(
    "https://api-mtls.test.hotelbeds.com" + path,
    {
      method,
      headers: {
        "Api-key": apiKey,
        "X-Signature": signature,
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
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
   HOTELBEDS AVAILABILITY
========================================================= */

const HOTEL_TEST_CODES = [
  3424,
  168,
];

async function hotelbedsAvailability(params, env) {
  const checkIn = String(params.checkIn || "");
  const checkOut = String(params.checkOut || "");

  if (!validDate(checkIn) || !validDate(checkOut)) {
    throw new Error(
      "checkIn and checkOut must be YYYY-MM-DD"
    );
  }

  if (new Date(checkOut) <= new Date(checkIn)) {
    throw new Error(
      "checkOut must be after checkIn"
    );
  }

  const adults = clamp(
    params.adults || 2,
    1,
    9
  );

  const rooms = clamp(
    params.rooms || 1,
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

  return hotelbedsRequest(
    "/hotel-api/1.0/hotels",
    "POST",
    body,
    env
  );
}

/* =========================================================
   NORMALIZE HOTELBEDS
========================================================= */

function normalizeHotelbedsResults(data, params) {
  const hotels =
    data?.hotels?.hotels ||
    data?.hotels?.hotel ||
    [];

  if (!Array.isArray(hotels)) {
    return [];
  }

  const nights = nightsBetween(
    params.checkIn,
    params.checkOut
  );

  const city = String(
    params.city || "Muscat"
  );

  const results = [];

  for (const hotel of hotels) {
    const hotelRooms = Array.isArray(hotel.rooms)
      ? hotel.rooms
      : [];

    let cheapestRate = null;
    let cheapestAmount = Infinity;

    for (const room of hotelRooms) {
      const rates = Array.isArray(room.rates)
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

    if (!cheapestRate) continue;

    const currency =
      cheapestRate.currency ||
      data?.auditData?.currency ||
      "EUR";

    const amountPerNight =
      cheapestAmount / nights;

    let stars = Number(
      String(hotel.categoryCode || "")
        .replace(/[^0-9]/g, "")
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
        cheapestRate.cancellationPolicies
      )
        ? cheapestRate.cancellationPolicies
        : [];

    results.push({
      id:
        "hotelbeds-" +
        String(hotel.code || results.length),

      accommodation: {
        id: String(hotel.code || ""),
        name: hotel.name || "Hotel",
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

      cheapest_rate_currency: currency,
      cheapest_rate_public_currency: currency,

      rooms: [
        {
          rates: [
            {
              cancellation_timeline:
                cancellationPolicies,

              rateKey:
                cheapestRate.rateKey || null,

              rateType:
                cheapestRate.rateType || null,

              boardName:
                cheapestRate.boardName || "",

              roomName:
                cheapestRate.roomName ||
                cheapestRate.room?.name ||
                "",

              net: cheapestAmount,
              currency,
            },
          ],
        },
      ],

      hotelbeds: {
        hotelCode: hotel.code || null,
        rateKey: cheapestRate.rateKey || null,
      },
    });
  }

  return results;
}

/* =========================================================
   DEMO HOTELS FALLBACK
========================================================= */

const DEMO_HOTELS = [
  {
    name: "Suhail Grand Hotel",
    stars: 5,
    score: 9.2,
    reviews: 824,
    price: 52,
    room: "Deluxe King Room",
    board: "Breakfast Included",
  },
  {
    name: "Suhail Marina Resort",
    stars: 5,
    score: 9.0,
    reviews: 631,
    price: 67,
    room: "Sea View Room",
    board: "Breakfast Included",
  },
  {
    name: "Suhail City Hotel",
    stars: 4,
    score: 8.7,
    reviews: 1104,
    price: 34,
    room: "Superior Room",
    board: "Room Only",
  },
  {
    name: "Suhail Boutique Hotel",
    stars: 4,
    score: 8.9,
    reviews: 472,
    price: 41,
    room: "Premium Room",
    board: "Breakfast Included",
  },
  {
    name: "Suhail Plaza",
    stars: 4,
    score: 8.5,
    reviews: 903,
    price: 29,
    room: "Standard King Room",
    board: "Room Only",
  },
  {
    name: "Suhail Royal Residence",
    stars: 5,
    score: 9.3,
    reviews: 356,
    price: 78,
    room: "Executive Suite",
    board: "Breakfast Included",
  },
];

function demoHotels(params) {
  const city =
    String(params.city || "Muscat").trim() ||
    "Muscat";

  const checkIn = String(params.checkIn || "");
  const checkOut = String(params.checkOut || "");

  if (!validDate(checkIn) || !validDate(checkOut)) {
    throw new Error(
      "checkIn and checkOut must be YYYY-MM-DD"
    );
  }

  if (new Date(checkOut) <= new Date(checkIn)) {
    throw new Error(
      "checkOut must be after checkIn"
    );
  }

  const nights = nightsBetween(
    checkIn,
    checkOut
  );

  const rooms = clamp(
    params.rooms || 1,
    1,
    10
  );

  return DEMO_HOTELS.map((hotel, index) => {
    const nightlyPrice =
      hotel.price + rooms * 2;

    const total =
      nightlyPrice * nights * rooms;

    return {
      id: `demo-hotel-${index + 1}`,

      accommodation: {
        id: `demo-${index + 1}`,

        name: hotel.name,

        rating: hotel.stars,

        review_score: hotel.score,

        review_count: hotel.reviews,

        location: {
          address: {
            city_name: city,
          },
        },

        photos: [],
      },

      cheapest_rate_total_amount:
        total.toFixed(2),

      cheapest_rate_amount_per_night:
        nightlyPrice.toFixed(2),

      cheapest_rate_currency: "OMR",

      cheapest_rate_public_currency:
        "OMR",

      rooms: [
        {
          rates: [
            {
              cancellation_timeline: [],

              rateKey:
                `demo-rate-${index + 1}`,

              rateType: "BOOKABLE",

              boardName:
                hotel.board,

              roomName:
                hotel.room,

              net: total,

              currency: "OMR",
            },
          ],
        },
      ],

      demo: {
        enabled: true,
        bookable: false,
      },
    };
  });
}

/* =========================================================
   STAYS — HOTELBEDS + AUTO FALLBACK
========================================================= */

async function stays(params, env) {
  /*
    Validate first so invalid user input does NOT
    silently turn into Demo results.
  */

  if (
    !validDate(params.checkIn) ||
    !validDate(params.checkOut)
  ) {
    throw new Error(
      "checkIn and checkOut must be YYYY-MM-DD"
    );
  }

  if (
    new Date(params.checkOut) <=
    new Date(params.checkIn)
  ) {
    throw new Error(
      "checkOut must be after checkIn"
    );
  }

  try {
    const hotelbedsData =
      await hotelbedsAvailability(
        params,
        env
      );

    const normalized =
      normalizeHotelbedsResults(
        hotelbedsData,
        params
      );

    /*
      If Hotelbeds replies successfully but
      returns no hotels, use Demo temporarily.
    */

    if (normalized.length === 0) {
      return {
        provider: "demo",
        fallback: true,
        fallbackReason:
          "Hotelbeds returned no available hotels",
        results: demoHotels(params),
        testMode: true,
      };
    }

    return {
      provider: "hotelbeds",
      fallback: false,
      results: normalized,

      searchId:
        hotelbedsData?.auditData?.processTime ||
        null,

      testMode: true,
      mtls: true,

      rawCount:
        hotelbedsData?.hotels?.total ??
        normalized.length,
    };
  } catch (error) {
    console.error(
      "Hotelbeds unavailable, using Demo:",
      error?.message
    );

    return {
      provider: "demo",

      fallback: true,

      fallbackReason:
        error?.message ||
        "Hotelbeds unavailable",

      results:
        demoHotels(params),

      testMode: true,

      hotelbedsPending: true,
    };
  }
}

/* =========================================================
   HEALTH
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
    ok: true,

    flights: {
      provider: "duffel",
      configured: duffelConfigured,
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

      autoFallback: true,

      fallbackProvider: "demo",
    },
  };
}

/* =========================================================
   WORKER
========================================================= */

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    try {
      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          name: "Suhail API",
          ok: true,
          message: "Suhail API is running",
          health: "/api/health",
        });
      }

      if (
        url.pathname === "/api/health" &&
        request.method === "GET"
      ) {
        return json(
          await health(env)
        );
      }

      if (request.method !== "POST") {
        return json(
          {
            error: "Method not allowed",
          },
          405
        );
      }

      let params = {};

      try {
        params = await request.json();
      } catch {
        return json(
          {
            error: "Invalid JSON body",
          },
          400
        );
      }

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
