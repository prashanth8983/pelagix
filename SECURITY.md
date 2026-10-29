# Security

## Reporting

Email security reports to `<security contact: fill in before publishing>`. Do not open a public issue for a vulnerability. You should get a reply within a week; if you don't, send a short follow-up.

Include what you found, how to reproduce it, and which component it is in (engine CLI, engine API, web app, zero-cache configuration).

## Scope

In scope: anything that lets a user read or change data beyond their role, run SQL that the guard should block, reach files or network from a query, take over an account, or bypass the CSRF and session checks. Also in scope: the Docker images and the compose stack as shipped.

Out of scope: issues that need an already-compromised editor or admin account (see the trust model below), denial of service by sending many expensive but allowed queries, and findings in third-party services (model providers, Snowflake, S3) rather than in how this project uses them.

## Trust model

There are three roles. Viewers can read scores, run read-only SQL through the guard, and ask questions. Editors can also change every config file, preview sources, and start pipeline runs. Admins manage users and see the audit log. An editor is a trusted operator: they can point a source at any path under the data directory, at any URL prefix an administrator has allowed, and at any Postgres database whose URL is in the engine's environment. Config changes are written to disk with a copy of the previous version and an audit log entry naming who saved them.

The engine API is an internal service. It authenticates with one shared bearer token, serves config and query endpoints without per-user roles, and must never be reachable from the public internet. Only the web app's server side talks to it; browsers never do. Two layers limit what SQL can do: the guard (one SELECT, known tables only, no file or system functions, a row cap) and the connection itself, which on DuckDB is opened read-only with external access disabled and on Postgres should use a role with SELECT on the warehouse schema only.
