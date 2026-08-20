const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function getToken() {
  return localStorage.getItem("zemen_token");
}

/**
 * Thin fetch wrapper. Attaches the JWT if present, parses JSON,
 * and throws an Error with the server's message on non-2xx responses
 * so callers can just try/catch instead of checking res.ok everywhere.
 *
 * If `body` is a FormData instance (file uploads), we skip JSON-encoding
 * and let the browser set the multipart Content-Type + boundary itself —
 * setting Content-Type manually for FormData breaks the boundary.
 */
async function request(path, { method = "GET", body, headers = {} } = {}) {
  const token = getToken();
  const isFormData = body instanceof FormData;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response body — leave data null, res.ok check below still applies.
    }
  }

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        data?.error || "You're going a bit fast — please wait a moment and try again."
      );
    }
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data;
}

/**
 * Fetches an admin-only image (deposit screenshots) as a blob URL.
 * A plain <img src="..."> can't attach an Authorization header, so we
 * fetch it ourselves and hand back an object URL for the <img> to use.
 * Caller is responsible for revoking the URL when done (see AdminDeposits).
 */
async function fetchImageBlobUrl(path) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to load image");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export const api = {
  register: (payload) => request("/auth/register", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),

  getWallet: () => request("/wallet/me"),
  getTransactions: () => request("/wallet/me/transactions"),

  getPaymentMethods: () => request("/wallet/payment-methods"),
  createDepositRequest: (formData) =>
    request("/wallet/deposit-requests", { method: "POST", body: formData }),
  listMyDepositRequests: () => request("/wallet/deposit-requests"),

  getPayoutProfile: () => request("/wallet/payout-profile"),
  upsertPayoutProfile: (payload) =>
    request("/wallet/payout-profile", { method: "PUT", body: payload }),

  createWithdrawalRequest: (payload) =>
    request("/wallet/withdrawal-requests", { method: "POST", body: payload }),
  listMyWithdrawalRequests: () => request("/wallet/withdrawal-requests"),
  getWithdrawalTerms: () => request("/wallet/withdrawal-terms"),

  getMyPoints: () => request("/wallet/points"),
  spin: () => request("/wallet/spin", { method: "POST" }),

  listGames: () => request("/games"),
  getGame: (gameId) => request(`/games/${gameId}`),
  getGameTickets: (gameId) => request(`/games/${gameId}/tickets`),
  buyTicket: (gameId, ticketNumber) =>
    request(`/games/${gameId}/tickets`, {
      method: "POST",
      body: ticketNumber ? { ticketNumber } : {},
    }),
  myTickets: () => request("/games/my-tickets"),
  recentWinners: () => request("/games/recent-winners"),
  myUnseenWins: () => request("/games/my-unseen-wins"),
  acknowledgeWin: (ticketId) => request(`/games/wins/${ticketId}/seen`, { method: "POST" }),

  createGame: (payload) => request("/admin/games", { method: "POST", body: payload }),

  listAdminDepositRequests: (status) =>
    request(`/admin/deposit-requests${status ? `?status=${status}` : ""}`),
  approveDeposit: (id) => request(`/admin/deposit-requests/${id}/approve`, { method: "POST" }),
  rejectDeposit: (id, note) =>
    request(`/admin/deposit-requests/${id}/reject`, { method: "POST", body: { note } }),
  getDepositScreenshotUrl: (id) =>
    fetchImageBlobUrl(`/admin/deposit-requests/${id}/screenshot`),

  listAdminWithdrawalRequests: (status) =>
    request(`/admin/withdrawal-requests${status ? `?status=${status}` : ""}`),
  approveWithdrawal: (id) => request(`/admin/withdrawal-requests/${id}/approve`, { method: "POST" }),
  rejectWithdrawal: (id, note) =>
    request(`/admin/withdrawal-requests/${id}/reject`, { method: "POST", body: { note } }),

  getReferrals: () => request("/referrals/me"),
};

export { getToken };
