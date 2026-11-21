# Owner-only canonical repository controls

Public visibility does not grant write access, but does permit viewing and forking under GitHub terms. You cannot stop people editing their own clones of public code. A private development repository with a selected public mirror is the practical stronger boundary; existing copies cannot be recalled.

Review organization owners, repository administrators, direct collaborators, team access, installed GitHub Apps, deploy keys and automation tokens. Retain only owner-approved writers. An organization owner or administrator can change settings; owner-only claims require auditing those principals too.

Use active branch rulesets: restrict updates to owner-authorized actors, block force pushes/deletions, require checks, and minimize bypass actors. Check the GitHub UI for controls supported by the repository plan. CODEOWNERS alone is not an access-control boundary. Requiring the sole owner to approve their own pull request can deadlock because authors cannot approve their own PR; design the owner merge path deliberately.

Default GITHUB_TOKEN to read-only; no write deploy keys; avoid pull_request_target workflows that execute untrusted code with credentials. Use MFA/passkeys and scoped credentials. Local training processes must have no GitHub credentials, no write access to the main checkout and no production database password.

Do not apply license changes automatically. Existing grants cannot simply be recalled. Public source is not necessarily open source. Choose a license with appropriate legal review. No organization permissions, rulesets, collaborators, visibility or licenses are changed by this bundle.
