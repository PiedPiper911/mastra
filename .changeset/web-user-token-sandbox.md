---
'mastracode-web': patch
---

MastraCode Web now acts as the connecting GitHub user instead of the app bot. Connecting GitHub persists the user's user-to-server token (with refresh support), and every project open injects it into their sandbox as persistent git + `gh` credentials plus their GitHub login/noreply commit identity — so the agent inside the VM can `git push` and `gh pr create` attributed to the user. The server-mediated commit, push, and PR routes prefer the same token, falling back to installation tokens (bot attribution) when no token is stored or its refresh grant has died.
