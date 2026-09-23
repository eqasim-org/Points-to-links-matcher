# Publish Points-to-links matcher on GitHub

The repository root is now `Points-to-links-matcher`, with the application under `web/`. Run Git commands from the root. Run npm commands from `web/`. The root `LICENSE` is MIT.

## Private data protection

The root `.gitignore` excludes `geneva/`, `zurich/`, `data/`, `exports/`, archives, CSVs, GeoJSONs, and GeoPackages. Explicit exceptions allow only the named public demo files under `web/public/`. Dependencies and build output are also ignored. Avoid `git add -f`, which bypasses these protections.

At the time of demo preparation, this new root repository's history contained only `LICENSE`: the private datasets had never been committed there. The copied `web/.git` metadata belonged to the previous repository and contained older sample history. It was preserved in the ignored root `.local-git-backup-web/` folder, outside the active Git history. Do not publish that backup. The application is now a normal subfolder of the new repository, not a nested repository. If you later commit private files, ignoring or deleting them does not remove them from earlier commits.

The approved demo is 54 clipped Geneva directed links with synthetic attributes, plus three generated points. Original private counts and network attributes are not included. The road geometry is still derived from your source network; confirm upstream sharing/attribution requirements before making it public. See [demo details](DEMO.md).

## Check and publish

From the repository root:

```sh
cd web
npm ci
npm test
npm run build
cd ..
git status --short
git ls-files
git add .
git diff --cached --stat
git diff --cached --name-only
```

Before committing, verify that the staged names do not include `geneva/`, `zurich/`, archives, `node_modules/`, or build output. The only intended geospatial/CSV data are the small public demo fixtures. Check other staged content for credentials/private information as well.

```sh
git commit -m "Add LinkMatch with small public Geneva demo"
git remote -v
```

If no `origin` exists, create an empty GitHub repository and add its URL (replace the placeholder):

```sh
git remote add origin https://github.com/YOUR_USERNAME/Points-to-links-matcher.git
git push -u origin main
```

If `origin` already exists, verify its URL instead of replacing it blindly. Do not force-push. GitHub authentication is needed only to publish source code, not to use the app. The workflow under `.github/workflows/` tests/builds the `web` application; it does not deploy it.
