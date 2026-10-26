"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { promisify } = require("node:util");
const { Pool } = require("pg");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataDirectory = path.join(os.homedir(), ".sanaa-yetu");
const usersFile = path.join(dataDirectory, "users.json");
const databaseFile = path.join(dataDirectory, "users.sqlite");
const usersJsonMigration = "users-json-v1";
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;
const registrationWindowMs = 60 * 60 * 1000;
const maxRegistrationsPerWindow = 5;
const maxBodyBytes = 8 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
const registrations = new Map();
let database;
let databaseMode;

const publicFiles = new Set(["index.html", "blog.html", "contact.html", "app.js"]);
const publicDirectories = new Set(["bootstrap", "images"]);
const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2"
};

function sendJson(response, status, payload, headers = {}) {
    response.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        ...headers
    });
    response.end(JSON.stringify(payload));
}

function setSecurityHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self' mailto:; base-uri 'self'; frame-ancestors 'none'"
    );
}

function cookieToken(request) {
    const cookieHeader = request.headers.cookie || "";
    const cookie = cookieHeader.split(";").map((item) => item.trim())
        .find((item) => item.startsWith("sanaa_session="));
    return cookie ? cookie.slice("sanaa_session=".length) : "";
}

function findSession(request) {
    const token = cookieToken(request);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        return null;
    }

    const sessionKey = crypto.createHash("sha256").update(token).digest("hex");
    const session = sessions.get(sessionKey);
    if (!session || session.expiresAt <= Date.now()) {
        sessions.delete(sessionKey);
        return null;
    }
    return { key: sessionKey, session };
}

function setSessionCookie(response, token, clear = false) {
    const attributes = [
        `sanaa_session=${clear ? "" : token}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${clear ? 0 : Math.floor(sessionLifetimeMs / 1000)}`
    ];
    if (process.env.NODE_ENV === "production") {
        attributes.push("Secure");
    }
    response.setHeader("Set-Cookie", attributes.join("; "));
}

function createSession(response, user) {
    const token = crypto.randomBytes(32).toString("hex");
    const key = crypto.createHash("sha256").update(token).digest("hex");
    sessions.set(key, {
        userId: user.id,
        name: user.name,
        email: user.email,
        expiresAt: Date.now() + sessionLifetimeMs
    });
    setSessionCookie(response, token);
}

function requireSameOrigin(request) {
    const origin = request.headers.origin;
    if (typeof origin !== "string") {
        return false;
    }
    try {
        const parsedOrigin = new URL(origin);
        return (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:")
            && parsedOrigin.host === request.headers.host;
    } catch {
        return false;
    }
}

async function readJson(request) {
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        const error = new Error("Send this request as JSON.");
        error.status = 415;
        throw error;
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) {
            const error = new Error("The request is too large.");
            error.status = 413;
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("Expected an object.");
        }
        return value;
    } catch {
        const error = new Error("The request contains invalid JSON.");
        error.status = 400;
        throw error;
    }
}

function normalizeEmail(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().toLowerCase();
}

function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email };
}

async function initializeDatabase() {
    if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be set to a managed PostgreSQL connection string in production.");
    }

    if (process.env.DATABASE_URL) {
        databaseMode = "postgres";
        const sslMode = process.env.PGSSL || (process.env.NODE_ENV === "production" ? "verify-full" : "disable");
        const sslOptions = {
            disable: false,
            require: { rejectUnauthorized: false },
            "verify-full": { rejectUnauthorized: true }
        };
        if (!Object.hasOwn(sslOptions, sslMode)) {
            throw new Error("PGSSL must be set to disable, require, or verify-full.");
        }
        database = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: sslOptions[sslMode],
            max: Number(process.env.PGPOOL_MAX || 10)
        });
        await database.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        `);
        await database.query("SELECT 1");
        return;
    }

    databaseMode = "sqlite";
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    await fs.chmod(dataDirectory, 0o700);
    database = new DatabaseSync(databaseFile);
    database.exec(`
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    await fs.chmod(databaseFile, 0o600);

    const completedMigration = database.prepare(
        "SELECT version FROM schema_migrations WHERE version = ?"
    ).get(usersJsonMigration);
    if (completedMigration) {
        return;
    }

    let users = [];
    try {
        const content = await fs.readFile(usersFile, "utf8");
        users = JSON.parse(content);
        if (!Array.isArray(users)) {
            throw new Error("The existing user file has an invalid format.");
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    for (const user of users) {
        const email = user && normalizeEmail(user.email);
        if (!user || typeof user.id !== "string" || typeof user.name !== "string"
            || typeof user.email !== "string" || email.length > 254
            || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || !/^[a-f0-9]{32}$/i.test(user.salt)
            || !/^[a-f0-9]{128}$/i.test(user.passwordHash)
            || typeof user.createdAt !== "string") {
            throw new Error("The existing user file contains an invalid account record.");
        }
    }

    const insertUser = database.prepare(`
        INSERT INTO users (id, name, email, salt, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    database.exec("BEGIN IMMEDIATE");
    try {
        for (const user of users) {
            insertUser.run(
                user.id,
                user.name,
                normalizeEmail(user.email),
                user.salt,
                user.passwordHash,
                user.createdAt
            );
        }
        database.prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
        ).run(usersJsonMigration, new Date().toISOString());
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

async function findUserByEmail(email) {
    if (databaseMode === "postgres") {
        const result = await database.query(`
            SELECT id, name, email, salt,
                password_hash AS "passwordHash",
                created_at AS "createdAt"
            FROM users
            WHERE email = $1
        `, [email]);
        return result.rows[0];
    }

    return database.prepare(`
        SELECT id, name, email, salt,
            password_hash AS passwordHash,
            created_at AS createdAt
        FROM users
        WHERE email = ?
    `).get(email);
}

async function insertUser(user) {
    if (databaseMode === "postgres") {
        await database.query(`
            INSERT INTO users (id, name, email, salt, password_hash, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [user.id, user.name, user.email, user.salt, user.passwordHash, user.createdAt]);
        return;
    }

    database.prepare(`
        INSERT INTO users (id, name, email, salt, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(user.id, user.name, user.email, user.salt, user.passwordHash, user.createdAt);
}

async function passwordDigest(password, salt) {
    return scrypt(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024
    });
}

function validateRegistration(body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 1 || name.length > 80) {
        return { error: "Enter a name between 1 and 80 characters." };
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: "Enter a valid email address." };
    }
    if (password.length < 12 || password.length > 128) {
        return { error: "Choose a password between 12 and 128 characters." };
    }
    return { name, email, password };
}

function clientAddress(request) {
    return request.socket.remoteAddress || "unknown";
}

function isRateLimited(address) {
    const attempt = loginAttempts.get(address);
    if (!attempt || attempt.startedAt + loginWindowMs <= Date.now()) {
        loginAttempts.delete(address);
        return false;
    }
    return attempt.count >= maxLoginAttempts;
}

function recordLoginFailure(address) {
    const now = Date.now();
    const attempt = loginAttempts.get(address);
    if (!attempt || attempt.startedAt + loginWindowMs <= now) {
        loginAttempts.set(address, { startedAt: now, count: 1 });
    } else {
        attempt.count += 1;
    }
}

function canRegister(address) {
    const attempt = registrations.get(address);
    if (!attempt || attempt.startedAt + registrationWindowMs <= Date.now()) {
        registrations.set(address, { startedAt: Date.now(), count: 1 });
        return true;
    }
    if (attempt.count >= maxRegistrationsPerWindow) {
        return false;
    }
    attempt.count += 1;
    return true;
}

async function handleAuth(request, response, url) {
    const route = url.pathname;

    if (request.method === "GET" && route === "/api/auth/me") {
        const found = findSession(request);
        if (!found) {
            return sendJson(response, 200, { authenticated: false, user: null });
        }
        return sendJson(response, 200, {
            authenticated: true,
            user: {
                id: found.session.userId,
                name: found.session.name,
                email: found.session.email
            }
        });
    }

    if (request.method !== "POST") {
        return sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, POST" });
    }
    if (!requireSameOrigin(request)) {
        return sendJson(response, 403, { error: "This request could not be verified. Refresh the page and try again." });
    }

    if (route === "/api/auth/logout") {
        const found = findSession(request);
        if (found) {
            sessions.delete(found.key);
        }
        setSessionCookie(response, "", true);
        return sendJson(response, 200, { authenticated: false, user: null });
    }

    if (route !== "/api/auth/register" && route !== "/api/auth/login") {
        return sendJson(response, 404, { error: "Not found." });
    }

    const address = clientAddress(request);
    if (isRateLimited(address)) {
        return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
    }

    const body = await readJson(request);
    if (route === "/api/auth/register") {
        const registration = validateRegistration(body);
        if (registration.error) {
            return sendJson(response, 400, { error: registration.error });
        }
        if (!canRegister(address)) {
            return sendJson(response, 429, { error: "Too many account requests. Try again in an hour." });
        }

        const salt = crypto.randomBytes(16);
        const digest = await passwordDigest(registration.password, salt);
        const user = {
            id: crypto.randomUUID(),
            name: registration.name,
            email: registration.email,
            salt: salt.toString("hex"),
            passwordHash: digest.toString("hex"),
            createdAt: new Date().toISOString()
        };
        try {
            await insertUser(user);
        } catch (error) {
            const duplicateEmail = databaseMode === "postgres"
                ? error.code === "23505" && error.constraint === "users_email_key"
                : error.code === "ERR_SQLITE_CONSTRAINT_UNIQUE"
                    && database.prepare("SELECT id FROM users WHERE email = ?").get(user.email);
            if (duplicateEmail) {
                const duplicate = new Error("An account with this email already exists.");
                duplicate.status = 409;
                throw duplicate;
            }
            throw error;
        }
        createSession(response, user);
        return sendJson(response, 201, { authenticated: true, user: publicUser(user) });
    }

    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (email.length > 254 || !email || password.length > 128 || !password) {
        recordLoginFailure(address);
        return sendJson(response, 401, { error: "Email or password is incorrect." });
    }

    const user = await findUserByEmail(email);
    const salt = user ? Buffer.from(user.salt, "hex") : Buffer.alloc(16);
    const calculated = await passwordDigest(password, salt);
    const expected = user ? Buffer.from(user.passwordHash, "hex") : Buffer.alloc(64);
    const validHash = expected.length === calculated.length && crypto.timingSafeEqual(expected, calculated);
    if (!user || !validHash) {
        recordLoginFailure(address);
        return sendJson(response, 401, { error: "Email or password is incorrect." });
    }

    loginAttempts.delete(address);
    createSession(response, user);
    return sendJson(response, 200, { authenticated: true, user: publicUser(user) });
}

async function serveStatic(request, response, url) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
    }

    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return sendJson(response, 400, { error: "Invalid URL." });
    }

    if (pathname === "/") {
        pathname = "/index.html";
    }
    const relativePath = pathname.replace(/^\/+/, "");
    const topLevel = relativePath.split(path.sep)[0];
    if (relativePath.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
        || (!publicFiles.has(relativePath) && !publicDirectories.has(topLevel))) {
        return sendJson(response, 404, { error: "Not found." });
    }

    const filename = path.resolve(root, relativePath);
    if (!filename.startsWith(`${root}${path.sep}`)) {
        return sendJson(response, 404, { error: "Not found." });
    }

    let stats;
    try {
        stats = await fs.stat(filename);
        if (!stats.isFile()) {
            return sendJson(response, 404, { error: "Not found." });
        }
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
            return sendJson(response, 404, { error: "Not found." });
        }
        throw error;
    }

    response.writeHead(200, {
        "Cache-Control": path.extname(filename) === ".html" ? "no-cache" : "public, max-age=3600",
        "Content-Length": stats.size,
        "Content-Type": mimeTypes[path.extname(filename)] || "application/octet-stream"
    });
    if (request.method === "HEAD") {
        return response.end();
    }
    return pipeline(createReadStream(filename), response);
}

async function handleRequest(request, response) {
    setSecurityHeaders(response);
    let url;
    try {
        url = new URL(request.url, `http://${request.headers.host}`);
    } catch {
        return sendJson(response, 400, { error: "Invalid request URL." });
    }

    if (url.pathname.startsWith("/api/")) {
        return handleAuth(request, response, url);
    }
    return serveStatic(request, response, url);
}

async function start() {
    await initializeDatabase();
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be a valid TCP port.");
    }

    const server = http.createServer((request, response) => {
        handleRequest(request, response).catch((error) => {
            if (error.status) {
                return sendJson(response, error.status, { error: error.message });
            }
            console.error("Request failed:", error);
            if (response.headersSent) {
                response.destroy();
                return;
            }
            sendJson(response, 500, { error: "The server could not complete the request." });
        });
    });

    const host = process.env.HOST
        || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
    server.listen(port, host, () => {
        console.log(`Sanaa Yetu is available at http://${host}:${port}`);
    });
}

for (const timer of [setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (session.expiresAt <= now) {
            sessions.delete(key);
        }
    }
    for (const [address, attempt] of loginAttempts) {
        if (attempt.startedAt + loginWindowMs <= now) {
            loginAttempts.delete(address);
        }
    }
    for (const [address, attempt] of registrations) {
        if (attempt.startedAt + registrationWindowMs <= now) {
            registrations.delete(address);
        }
    }
}, 60 * 1000)]) {
    timer.unref();
}

start().catch((error) => {
    console.error("Server failed to start:", error);
    process.exitCode = 1;
});
