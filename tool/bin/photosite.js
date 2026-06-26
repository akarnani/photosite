#!/usr/bin/env node
// photosite CLI entry point.
import { Command } from 'commander';
import * as ui from '../src/ui.js';
import { setup } from '../src/commands/setup.js';
import { addTrip } from '../src/commands/add-trip.js';
import { updateTrip } from '../src/commands/update-trip.js';
import { annotate } from '../src/commands/annotate.js';
import { cover } from '../src/commands/cover.js';
import { preview } from '../src/commands/preview.js';
import { push } from '../src/commands/push.js';
import { list } from '../src/commands/list.js';

// Wrap an action so thrown errors print a friendly line and exit non-zero.
const run =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      ui.fail(e.message);
    }
  };

const program = new Command();
program
  .name('photosite')
  .description('Manage the underwater photography portfolio (site + R2 images).')
  .version('0.1.0');

program.command('setup').description('Re-runnable configuration wizard').action(run(setup));

program
  .command('add-trip')
  .description('Ingest a folder of photos as a new trip')
  .option('--name <name>', 'trip name')
  .option('--location <location>', 'location, e.g. "Raja Ampat, Indonesia"')
  .option('--dates <dates>', 'trip dates label, e.g. "March 2025" (default: derived from photo EXIF)')
  .option('--from <folder>', 'source photo folder')
  .option('--no-upload', 'process & cache locally without uploading to R2')
  .action(run(addTrip));

program
  .command('update-trip')
  .description('Re-sync an existing trip from a folder')
  .argument('[slug]', 'trip slug (prompts if omitted)')
  .option('--from <folder>', 'source photo folder')
  .option('--prune', 'delete orphaned R2 objects without asking')
  .option('--no-upload', 'process & cache locally without uploading to R2')
  .action(run(updateTrip));

program
  .command('annotate')
  .description('Guided species / caption / title editor')
  .argument('[slug]', 'trip slug (prompts if omitted)')
  .action(run(annotate));

program
  .command('cover')
  .description('Pick the trip cover photo')
  .argument('[slug]', 'trip slug (prompts if omitted)')
  .action(run(cover));

program.command('preview').description('Run the local preview server').action(run(preview));

program
  .command('push')
  .description('Commit pending changes and push (triggers the deploy)')
  .argument('[message]', 'commit message (prompts if omitted)')
  .action(run(push));

program.command('list').description('List trips').action(run(list));

program.parseAsync(process.argv);
