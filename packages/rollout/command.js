const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const execa = require('execa');
const semver = require('semver');
const { createAltPublishDir } = require('@4c/file-butler');

const GitUtilities = require('@4c/cli-core/GitUtilities');
const ConsoleUtilities = require('@4c/cli-core/ConsoleUtilities');
const PromptUtilities = require('@4c/cli-core/PromptUtilities');

const writeJson = (p, json) => fs.writeJson(p, json, { spaces: 2 });

async function runLifecycle(script, pkg) {
  if (!pkg.scripts || !pkg.scripts[script]) return;
  await execa('npm', ['run', script], { stdio: [0, 1, 'pipe'] });
}

async function maybeRollbackGit(tag, skipGit, skipVersion) {
  if (skipGit) return;
  const confirmed = await PromptUtilities.confirm(
    'There was a problem publishing, do you want to rollback the git operations?',
  );
  await ConsoleUtilities.step(
    `Rolling back git operations`,
    async () => {
      await GitUtilities.removeTag(tag);
      if (!skipVersion) await GitUtilities.removeLastCommit();
    },
    !confirmed,
  );
}

async function bumpVersion(pkg, publishDir, cwd) {
  const json = pkg;
  const pkgPath = path.join(cwd, 'package.json');
  await writeJson(pkgPath, json);

  if (publishDir) {
    await createAltPublishDir({ outDir: publishDir });
  }
}

async function getNextVersion(version, currentVersion, preid) {
  const patch = semver.inc(currentVersion, 'patch');
  const minor = semver.inc(currentVersion, 'minor');
  const major = semver.inc(currentVersion, 'major');
  const prepatch = semver.inc(currentVersion, 'prepatch');
  const preminor = semver.inc(currentVersion, 'preminor');
  const premajor = semver.inc(currentVersion, 'premajor');

  if (semver.valid(version)) {
    return version;
  }
  switch (version) {
    case 'patch':
      return patch;
    case 'minor':
      return minor;
    case 'major':
      return major;
    default:
  }

  const message = `Select a new version (currently ${currentVersion})`;

  const choice = await PromptUtilities.select(message, {
    choices: [
      { value: patch, name: `Patch (${patch})` },
      { value: minor, name: `Minor (${minor})` },
      { value: major, name: `Major (${major})` },
      { value: prepatch, name: `Prepatch (${prepatch})` },
      { value: preminor, name: `Preminor (${preminor})` },
      { value: premajor, name: `Premajor (${premajor})` },
      { value: 'PRERELEASE', name: 'Prerelease' },
      { value: 'CUSTOM', name: 'Custom' },
    ],
  });

  switch (choice) {
    case 'CUSTOM': {
      return PromptUtilities.input('Enter a custom version', {
        filter: semver.valid,
        validate: v => v !== null || 'Must be a valid semver version',
      });
    }

    case 'PRERELEASE': {
      const [existingId] = semver.prerelease(currentVersion) || [];
      const defaultVersion = semver.inc(
        currentVersion,
        'prerelease',
        existingId,
      );
      const prompt = `(default: ${
        existingId ? `"${existingId}"` : 'none'
      }, yielding ${defaultVersion})`;

      const nextPreId =
        preid !== 'latest'
          ? preid
          : await PromptUtilities.input(
              `Enter a prerelease identifier ${prompt}`,
            );

      return semver.inc(currentVersion, 'prerelease', nextPreId);
    }

    default: {
      return choice;
    }
  }
}

exports.command = '$0 [nextVersion]';

exports.describe = 'Publish a new version';

exports.builder = _ =>
  _.positional('nextVersion', {
    type: 'string',
    describe: 'The next version',
  })
    .pkgConf('release')
    .option('preid', {
      type: 'string',
    })
    .option('prerelease', {
      type: 'bool',
      default: false,
    })
    .option('publish-dir', {
      type: 'string',
    })
    .option('allow-branch', {
      group: 'Command Options:',
      describe: 'Specify which branches to allow publishing from.',
      type: 'array',
      default: ['master'],
    })
    .option('npm-tag', {
      type: 'string',
    })
    .option('skip-version', {
      describe: 'Skip version bumping',
      type: 'boolean',
    })
    .option('skip-checks', {
      describe: 'Skip tests, linting and git hygiene checks',
      type: 'boolean',
    })
    .option('skip-git', {
      describe: 'Skip commiting, tagging, and pushing git changes.',
      type: 'boolean',
    })
    .option('skip-npm', {
      describe: 'Stop before actually publishing change to npm.',
      type: 'boolean',
    })
    .option('public', {
      type: 'bool',
      default: undefined,
    });

exports.handler = async ({
  preid,
  nextVersion: version,
  npmTag,
  skipChecks,
  skipGit,
  skipNpm,
  skipVersion,
  allowBranch,
  publishDir,
  public: isPublic,
}) => {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');
  const pkg = require(pkgPath);

  try {
    await ConsoleUtilities.step(
      'Checking repo and running tests',
      async () => {
        if (!skipGit) {
          await GitUtilities.assertClean();
          await GitUtilities.assertMatchesRemote();
        }
        const branch = await GitUtilities.getCurrentBranch();

        if (!allowBranch.includes(branch))
          throw new Error(`Cannot publish from branch: ${chalk.bold(branch)}`);

        await execa('npm', ['test'], { stdio: [0, 1, 'pipe'] });
      },
      skipChecks,
    );

    let nextVersion = pkg.version;

    if (skipVersion) {
      ConsoleUtilities.spinner().warn(
        `Using existing version: ${chalk.bold(nextVersion)}`,
      );
    } else {
      nextVersion = await getNextVersion(version, pkg.version, preid);

      await ConsoleUtilities.step(
        `Bumping version to: ${chalk.bold(nextVersion)}  (${chalk.dim(
          `was ${pkg.version}`,
        )})`,
        () => bumpVersion({ ...pkg, version: nextVersion }, publishDir, cwd),
      );
    }

    const isPrerelease = !!semver.prerelease(nextVersion);
    const tag = npmTag || isPrerelease ? 'next' : 'latest';

    const confirmed = await PromptUtilities.confirm(
      `Are you sure you want to publish version: ${nextVersion}@${tag}?`,
    );

    if (!confirmed) return;
    const gitTag = `v${nextVersion}`;

    await ConsoleUtilities.step(
      'Tagging and committing version bump',
      async () => {
        if (!skipVersion) {
          await GitUtilities.addFile(pkgPath);
          await GitUtilities.commit(`Publish ${gitTag}`);
        }
        await GitUtilities.addTag(gitTag);
      },
      skipGit,
    );

    try {
      await ConsoleUtilities.step(
        'Publishing to npm',
        async () => {
          const args = ['publish'];
          if (publishDir) {
            args.push(publishDir);
            // We run the lifecycle scripts manually to ensure they run in
            // the package root, not the publish dir
            await runLifecycle('prepublish', pkg);
            await runLifecycle('prepare', pkg);
            await runLifecycle('prepublishOnly', pkg);
          }
          if (tag !== 'latest') {
            args.push('--tag', tag);
          }

          if (isPublic != null) {
            args.push('--access', isPublic ? 'public' : 'restricted');
          }
          await execa('npm', args, { stdio: [0, 1, 'pipe'] });

          try {
            if (publishDir) {
              await runLifecycle('publish', pkg);
              await runLifecycle('postpublish', pkg);
            }
          } catch (err) {
            console.error(err);
            /* we've already published so we shouldn't try and rollback if these fail */
          }
        },
        skipNpm,
      );
    } catch (err) {
      await maybeRollbackGit(gitTag, skipGit, skipVersion);
      throw err;
    }

    if (!skipGit) {
      await GitUtilities.pushWithTags();
    }

    console.log(
      `🎉  Published v${nextVersion}@${tag}:  ${chalk.blue(
        skipNpm
          ? await GitUtilities.getRemoteUrl()
          : `https://npm.im/${pkg.name}`,
      )} \n`,
    );
  } catch (err) {
    /* ignore */
  }
};
