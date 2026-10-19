# Install Jarvis

Jarvis 0.1.x has been installed on Arch Linux x86-64 and macOS 26.4 arm64 with
Docker Compose. Other host versions, including Ubuntu 24.04, have not completed
the release acceptance. Its production Compose stack includes the Continuwuity
Matrix homeserver. You also need an
OpenAI-compatible chat-completions endpoint; Jarvis does not install or manage
the model server.

`pnpm jarvis:setup` is the guided install path. It prepares protected state,
publishes reviewed artifacts, starts Matrix bootstrap, registers the owner and
brain accounts, saves the brain E2EE recovery key, seals temporary
registration, migrates PostgreSQL, and starts production services. It pauses
for Element recovery and trust decisions. The [Matrix bootstrap guide](matrix-bootstrap.md)
and [production runbook](../operations/production-runbook.md) contain stage
details and manual recovery commands.

## Requirements

- Arch Linux x86-64 or macOS 26.4 arm64 with Docker Engine/Desktop, Compose,
  and Buildx. The observed toolchains are listed in the
  [release checklist](../development/public-release-checklist.md#supported-public-surface);
  older minimum versions have not been verified.
- Node.js 24, Corepack, and pnpm 11.5.0 for setup and operator commands.
- A permanent Matrix server name. The bundled Continuwuity service hosts the
  owner and Jarvis accounts. Guided setup records their IDs and the brain
  access token in protected state. Back up Element's owner recovery key and
  the separate brain recovery key in a password manager.
- An OpenAI-compatible `/v1/chat/completions` endpoint and model. The endpoint
  URL entered during setup must point to a service reachable from the Jarvis
  host and the inference gateway container. The default is
  `http://127.0.0.1:8080/v1`. For a local service, setup checks the host through
  `127.0.0.1` and configures the container through `host.docker.internal`,
  whichever of those names you enter. The credential-free question defaults to
  "no"; setup then immediately prompts for the API key.
- The reviewed PostgreSQL image and Whisper model defaults in the setup
  configuration. Change them only when deliberately selecting replacements
  and reviewing their immutable references/checksums.

Keep Matrix, Docker administration, and operator endpoints on a private network.
Review the [security model](../architecture/security-and-threat-model.md) before
opening any network access.

## Guided installation

From a clean checkout, install the locked dependencies and start setup:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm jarvis:setup
```

Setup collects the permanent Matrix name and inference settings, checks
prerequisites before writing state, shows a redacted review, and asks for
confirmation. It records progress under the platform state directory:

- Linux: `${XDG_STATE_HOME:-~/.local/state}/jarvis`
- macOS: `~/Library/Application Support/Jarvis`

Keep the setup terminal open while completing the Tailscale and Element steps
in another window. Press Enter when private HTTPS is ready, and answer the
recovery-key and trust prompts when those steps are complete. Setup then
continues in the same command. At the HTTPS prompt, type `q` to pause safely;
run `pnpm jarvis:setup` later to resume from the saved checkpoint.
`pnpm jarvis:setup --status` reports checkpoints
and the next action without changing state. Leave the owner Matrix ID empty in
the initial configuration; entering an ID does not register the account. The
first owner registration uses the one-time first-user token in homeserver logs;
setup reads and displays it during registration, then uses it automatically.
If the log message is missing or ambiguous, setup asks for the token with hidden
input. If an owner ID was entered but the account is absent, the guide clears
the stale ID and resumes registration only when it can verify that the
homeserver has no users. Otherwise, it stops for manual reconciliation.
If owner registration has an uncertain result, setup verifies the account
using the password just entered and records its ID without registering again.
If that check cannot finish, run `pnpm jarvis:setup` later; it asks for the
same owner username and password to reconcile the pending registration.
After registration, open the Element X mobile app or Element Web at
`https://app.element.io` and select the Matrix server URL as a custom
homeserver. The homeserver URL itself is not the Element client. Sign in with
the owner password, without the registration token. The brain registration
token is read from protected state. If private HTTPS is not ready, use the
Tailscale Serve commands in the [Matrix bootstrap
guide](matrix-bootstrap.md), then resume.

After owner registration, sign in to Element X and complete its message backup
prompt. If the prompt has not appeared, open your profile avatar > Encryption >
Get recovery key. Element X generates the **owner recovery key** on your device;
setup cannot show that key. Save it in a password manager. Later, setup
displays the separate **brain recovery key** after saving it in protected
Jarvis state; back it up in the password manager too. Review or save the
displayed brain identity keys before confirming the installer prompt. Once
services start, create the private room and verify the brain device in Element.
An interrupted account or identity creation with an uncertain outcome stops for
reconciliation and is never retried automatically.

## Reviewed non-interactive preparation

For structured setup preparation, copy and edit the ignored example file:

```sh
cp deploy/compose/setup.config.example.json deploy/compose/setup.config.json
chmod 600 deploy/compose/setup.config.json
pnpm jarvis:setup --config deploy/compose/setup.config.json --yes
```

Set the permanent Matrix name and inference URL/model identifiers, and provide
the inference credential in `inference.apiKey` when `credentialFree` is
`false`. Leave the optional Matrix account fields empty for bootstrap. Confirm
`exposure.privateNetworkConfirmed=true` only after reviewing the private
network. Keep the file untracked, mode `0600`, and out of shell history and
chat. The example pins the reviewed PostgreSQL image and Whisper checksum;
preserve those unless you deliberately verify replacements.

This mode prepares `production.env` with mode `0600` and records setup stages.
It does not perform interactive Matrix registration. Resume with
`pnpm jarvis:setup` in a terminal. `--validate-inference` additionally
sends a minimal model request; normal preflight checks connectivity without
sending one. The individual `--publish-artifacts`, `--seal-matrix-registration`,
`--migrate`, and `--start` commands remain available for recovery and reviewed
automation.

## Finish deployment

Once services start, create a private room in Element X as the owner, invite
the brain account, verify its device, and confirm its first encrypted reply.
Keep generated state, database backups, Matrix recovery material, and runtime
artifacts protected.

For day-to-day operation after setup, use the [daily commands](../operations/daily-commands.md).
To permanently remove a deployment, follow [Delete a Jarvis deployment](../operations/uninstall.md).
