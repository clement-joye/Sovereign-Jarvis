# Matrix and Tailscale Bootstrap

Use this as stage detail or a manual recovery path for a new private deployment.
The primary path is `pnpm jarvis:setup` in the [install guide](install.md). It
registers the Matrix owner and brain accounts and creates the environment
values required by the production gateway.
Create the private room after the production stack has started, as described in
the production runbook.

Prepare the protected setup state with `pnpm jarvis:setup` first, leaving the
Matrix account IDs and credentials blank until this guide creates them. This
guide uses that state directory's `production.env` throughout. It uses the same
Compose project name as the production stack so the homeserver volume survives
the transition.

Set `JARVIS_STATE_ROOT` for the host, then derive the environment path:

```sh
# Linux default
export JARVIS_STATE_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/jarvis"
# macOS default (use this instead on macOS)
# export JARVIS_STATE_ROOT="$HOME/Library/Application Support/Jarvis"
export JARVIS_ENV_FILE="$JARVIS_STATE_ROOT/production.env"
```

## 1. Choose the permanent Matrix name

Choose a stable Tailscale node name before registering any accounts. With
MagicDNS it becomes a name such as:

```text
jarvis.<tailnet>.ts.net
```

Set `MATRIX_SERVER_NAME` in the setup configuration before running setup. The
setup command writes it to the protected environment file:

```text
MATRIX_SERVER_NAME=jarvis.<tailnet>.ts.net
MATRIX_HOST_PORT=8008
```

Matrix user and room IDs include this server name and cannot be renamed later.

On macOS, Tailscale's CLI may not be on `PATH`. Either install the app's CLI
integration, or add this to `~/.zshrc` and run `source ~/.zshrc`:

```sh
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
```

## 2. Create a temporary brain-registration token

Setup generates the temporary registration token in `production.env` as
`CONTINUWUITY_REGISTRATION_TOKEN`. The brain registration helper reads it
directly from the protected file; there is no copy-and-paste prompt. Do not
print it into a terminal transcript or paste it into chat. It is used only
for registering the brain service account and is removed after
bootstrap completes. It is different from the one-time first-user token
printed in the homeserver logs in the next step: use that first-user token
only when creating the owner account.

## 3. Start Continuwuity only

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.matrix-bootstrap.yml up --detach
```

Watch the logs for Continuwuity's first-user token. It is emitted when the
homeserver has no existing owner account and is used in step 5:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.matrix-bootstrap.yml logs --follow matrix-homeserver
```

## 4. Expose the homeserver privately with HTTPS

Continuwuity listens only on the loopback `MATRIX_HOST_PORT` chosen during
setup (8008 by default). Use that port in the command below if you changed it.
Use Tailscale Serve; do not use Tailscale Funnel.

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8008
tailscale serve status
```

This hostname's HTTPS port 443 root is reserved for Matrix. To expose a model
from the same host, use a separate HTTPS port, for example:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8080
```

or

```sh
tailscale serve --bg --https=9443 http://127.0.0.1:8080
```

Do not omit `--https=8443`: the default HTTPS listener is port 443 and would
replace the Matrix root handler.

From another device on the tailnet, verify the Matrix Client-Server API:

```sh
curl https://jarvis.<tailnet>.ts.net/_matrix/client/versions
```

Use `https://jarvis.<tailnet>.ts.net` as Element X's custom homeserver URL.
Jarvis also configures Continuwuity's client well-known URL to this public
HTTPS address in both bootstrap and production Compose. OAuth-capable clients
use it when signing in. After applying a Compose change, check
`https://jarvis.<tailnet>.ts.net/.well-known/matrix/client` before retrying
sign-in.

## 5. Create the owner account

Guided setup creates the owner account using the first-user token from the
homeserver logs, prompting for an owner username and password. It reads,
displays, and uses the token automatically when the log message is clear;
otherwise it asks for the token with hidden input.
If registration succeeds but setup cannot record the owner ID, it verifies the
account with the password just entered and records its ID without repeating
registration. If verification cannot finish, rerun `pnpm jarvis:setup` later;
the pending-registration path asks for the same username and password.
It stores only `MATRIX_OWNER_ID`; sign in to Element X afterward. For the
manual path, create the owner account in Element X using the same token. This
token is not the temporary brain-registration token.
After account creation, Element X may take a short time before prompting you to
back up messages. Choose the backup option when it appears, save the recovery
key in a password manager, and confirm it in Element X to finish enabling the
backup. Do not close or dismiss the prompt before saving the key. This Element
recovery key is separate from the brain recovery key generated in step 7.

Use Element X profile sharing to find the full Matrix ID, then set
`MATRIX_OWNER_ID` in `$JARVIS_ENV_FILE` with a local editor:

```text
MATRIX_OWNER_ID=@owner:jarvis.<tailnet>.ts.net
```

## 6. Create the brain service account

Use the helper rather than a second mobile client. It reads
`CONTINUWUITY_REGISTRATION_TOKEN` from the protected `production.env` file and
prompts for a new password without echoing it.
It creates the account and writes the brain access token directly to the
protected setup environment file without printing it:

```sh
node scripts/matrix/matrix-login.mjs --register \
  --homeserver https://jarvis.<tailnet>.ts.net \
  --username brain \
  --env-file "$JARVIS_ENV_FILE"
```

This writes the brain account ID and access token directly into the protected
setup environment file:

```text
MATRIX_BRAIN_USER_ID=@brain:jarvis.<tailnet>.ts.net
MATRIX_ACCESS_TOKEN=<secret>
```

## 7. Bootstrap the brain account's cross-signing identity

Use Node.js 24 for the setup commands; the installer rejects Node.js 22 before
writing state. Do this once, after the gateway image has been built and before
starting the long-running gateway. It creates the brain account's cross-signing
identity. The bootstrap first saves a protected recovery handoff in the
`matrix-crypto` volume, then prints the key. Keep the key in a password manager
and persist it to setup state immediately. Do not run identity creation again
after it may have succeeded.

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  build matrix-gateway
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml \
  run --rm --no-deps matrix-gateway \
  node apps/matrix-gateway/dist/src/bootstrap/bootstrap-e2ee.js
```

Persist the printed key with the setup command. It prompts for the value without
echoing it and writes it atomically to the protected `production.env` file:

```sh
pnpm jarvis:setup --store-matrix-recovery-key --state-root "$JARVIS_STATE_ROOT"
```

Then save the key separately in your password manager before starting the
gateway. The command confirms only that the value was persisted; it cannot
verify the key or confirm the separate password-manager backup. The gateway
restores the cross-signing identity from that secret and signs its persistent
Matrix device. Never place the recovery key in chat, source control, command
arguments, or ordinary logs. Identity creation is a one-time operation. If the
command failed or the key was not saved in setup state, do not rerun it.
Inspect the protected handoff:

```sh
docker compose --project-name jarvis --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.production.yml run --rm --no-deps -T matrix-gateway \
  node apps/matrix-gateway/dist/src/bootstrap/bootstrap-e2ee.js --status \
  '@brain:jarvis.<tailnet>.ts.net'
```

`key-persisted` means the key can be recovered from the volume with the same
command using `--show-recovery-key` instead of `--status`, with the same brain
Matrix ID argument. That command prints
the secret, so use a private terminal and store it immediately. `ambiguous`
means identity creation started but no key was saved; stop and recover from a
protected backup or the homeserver's supported recovery process. Never remove
the pending marker to force a retry. The `matrix-crypto` volume may already
contain the identity.
If this is a genuinely new deployment and you are willing to discard its
Matrix accounts, rooms, and keys, follow [Starting over](#starting-over-before-production)
to remove both Matrix volumes and recreate the accounts. If this deployment
contains Matrix data you need to keep, stop and recover from a protected backup
or the homeserver's supported recovery process before continuing.

After an interruption, run `pnpm jarvis:setup --status --state-root
"$JARVIS_STATE_ROOT"`. Its Matrix checkpoint lines report whether the owner ID,
brain ID, access token, recovery key, and E2EE setting are present, and whether
registration is disabled and its temporary token removed. It never displays
their values. Continue at the first missing item; do not repeat the one-time
cross-signing identity creation after the recovery key has been persisted.

### 7b. Manually trust a reviewed Matrix identity

If Element is configured to share room keys only with trusted identities, use the
following local operator script to cross-sign one explicitly reviewed Matrix user
identity. This is not a substitute for normal SAS verification: it grants trust to
the target user's master key and therefore to that user's self-signed devices.

Run it only on a trusted machine. Supply the target master-key fingerprint from an
independent trusted source. The script prompts without echoing for the owner access
token and the owner's user-signing private key; it stores neither. The latter is the
base64-encoded 32-byte user-signing seed, not the Brain account recovery key.

First retrieve the Brain account's current master-key fingerprint. This is a
read-only request and prompts only for the owner access token:

```sh
node scripts/matrix/matrix-trust-user.mjs \
  --homeserver https://jarvis.<tailnet>.ts.net \
  --owner-user @owner:jarvis.<tailnet>.ts.net \
  --target-user @brain:jarvis.<tailnet>.ts.net \
  --show-target-master-key
```

Independently compare that value with the reviewed Brain identity before trusting
it. It is not the gateway device's Ed25519 identity printed in gateway startup
logs.

```sh
node scripts/matrix/matrix-trust-user.mjs \
  --homeserver https://jarvis.<tailnet>.ts.net \
  --owner-user @owner:jarvis.<tailnet>.ts.net \
  --target-user @brain:jarvis.<tailnet>.ts.net \
  --target-master-key <reviewed-brain-master-ed25519-fingerprint> \
  --yes 'TRUST @brain:jarvis.<tailnet>.ts.net <reviewed-brain-master-ed25519-fingerprint>'
```

To pass the access token or signing key as CLI values for automation, add their
respective options and `--allow-cli-secrets`. This exposes those secrets to shell
history and process inspection, so interactive entry is the preferred mode.

## 8. Finish bootstrap

Stop only the bootstrap stack while the temporary token is still in the
environment file:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.matrix-bootstrap.yml down
```

Do not add `--volumes`: `matrix-data` contains the accounts and room.

After shutting down the bootstrap stack, ensure these values are populated in
the protected `production.env`: `MATRIX_OWNER_ID`, `MATRIX_BRAIN_USER_ID`,
`MATRIX_ACCESS_TOKEN`, and `MATRIX_RECOVERY_KEY`. The E2EE setting must remain
`MATRIX_E2EE_ENABLED='true'`. If the recovery key was not persisted in step 7a,
run the hidden-input command there before continuing. Then run:

```sh
pnpm jarvis:setup --seal-matrix-registration --state-root "$JARVIS_STATE_ROOT"
```

This command validates those Matrix and E2EE fields, removes the temporary
registration token and sets `CONTINUWUITY_ALLOW_REGISTRATION='false'` through
an atomic mode-0600 file replacement. It requires that registration setting to
appear exactly once, then records the Matrix bootstrap checkpoint only after
readiness validation succeeds. It does not display or rotate any secret. Then
continue with the [production runbook](../operations/production-runbook.md) to
migrate the database and start the production stack. Once it is running, create
a private room as the owner and invite the brain account. The gateway accepts
trusted owner invitations and registers a workspace for the room; there is no
global room ID to configure. Keep `MATRIX_E2EE_ENABLED='true'`, the production
default. Verify the brain device in Element before relying on encrypted
messages. Its cryptographic identity and room keys are retained in the
`matrix-crypto` Docker volume. Back up that volume with the same protections as
the Matrix access token; deleting it creates a new Matrix device and prevents
the gateway from decrypting existing room history. Encrypted text is supported;
encrypted media attachment decryption and encryption are not yet supported.
The guided installer runs brain identity creation and imports its protected
recovery key. Owner recovery and Matrix trust still require the operator's
explicit actions in Element.

## Starting over before production

Use this only before the first production start, when you intend to discard the
Matrix bootstrap and its identities. If production has already been initialized,
this is not a full deployment reset: follow the maintenance and recovery
procedures for existing data instead. Do not use the production Compose file
with `down --volumes`; that also deletes PostgreSQL and application data.

Remove the bootstrap homeserver and its `matrix-data` volume:

```sh
docker compose --project-name jarvis \
  --env-file "$JARVIS_ENV_FILE" \
  -f deploy/compose/compose.matrix-bootstrap.yml down --volumes --remove-orphans
```

The E2EE bootstrap one-off command also creates the production Compose
`matrix-crypto` volume. Remove that volume separately, after confirming the
project and exact volume name:

```sh
docker volume ls --filter label=com.docker.compose.project=jarvis
docker volume rm jarvis_matrix-crypto
```

With the documented project name, `jarvis_matrix-crypto` is the expected name;
if you chose another Compose project name, use the matching exact volume name
shown by `docker volume ls`. Remove only the Matrix crypto volume. Do not use
`docker volume prune`, which can delete unrelated data. These steps
irreversibly delete Matrix accounts, rooms, media, and recovery material. In
the protected `production.env`, clear the old Matrix IDs, access token, and
recovery key before recreating accounts; do not display or copy those values.
Then repeat this guide from step 3 with fresh accounts and a newly generated
recovery key.
