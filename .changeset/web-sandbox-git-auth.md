---
'mastracode-web': patch
---

Sandboxes in MastraCode Web now get working GitHub credentials on every project open: a freshly minted installation token is injected as persistent git + `gh` credentials (`~/.git-credentials`, `hosts.yml`), so the agent inside the VM can `git push` and `gh pr create` directly. Connecting GitHub captures the user's GitHub identity (login/name/email — no tokens stored) and sets it as the git author, so commits are attributed to the user on GitHub even though pushes and PRs act as the app.
