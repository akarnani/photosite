#!/usr/bin/env node
// photosite CLI entry point.
import { Command } from 'commander';
import * as ui from '../src/ui.js';
import { setup } from '../src/commands/setup.js';
import { addTrip } from '../src/commands/add-trip.js';
import { addTrips } from '../src/commands/add-trips.js';
import { updateTrip } from '../src/commands/update-trip.js';
import { annotate } from '../src/commands/annotate.js';
import { cover } from '../src/commands/cover.js';
import { preview } from '../src/commands/preview.js';
import { upload } from '../src/commands/upload.js';
import { push } from '../src/commands/push.js';
import { list } from '../src/commands/list.js';
import { favorites } from '../src/commands/favorites.js';

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
  .option('--slug <slug>', 'URL slug (default: name + year, e.g. "blue-o-two-2024")')
  .option('--location <location>', 'location, e.g. "Raja Ampat, Indonesia"')
  .option('--dates <dates>', 'trip dates label, e.g. "March 2025" (default: derived from photo EXIF)')
  .option('--from <folder>', 'source photo folder')
  .option('--no-upload', 'process & cache locally without uploading to R2')
  .action(run(addTrip));

program
  .command('add-trips')
  .description('Bulk-ingest trips by scanning a parent folder')
  .argument('[parent]', 'parent folder to scan (prompts if omitted)')
  .option('--from <parent>', 'parent folder to scan')
  .option('--min <n>', 'only list folders with at least n images', '1')
  .option('--no-upload', 'process & cache locally without uploading to R2')
  .action(run(addTrips));

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
  .command('upload')
  .description("Upload a trip's processed images from the local cache to R2")
  .argument('[slug]', 'trip slug (prompts if omitted)')
  .option('--all', 'upload every trip that has a local cache')
  .action(run(upload));

program
  .command('push')
  .description('Commit pending changes and push (triggers the deploy)')
  .argument('[message]', 'commit message (prompts if omitted)')
  .action(run(push));

program.command('list').description('List trips').action(run(list));

program
  .command('favorites')
  .description('Narrow all photos down to your N favorites, two at a time (e.g. for printing)')
  .option('--count <n>', 'how many favorites to keep (prompts on a new session; default 20)')
  .option('--lives <n>', 'losses before a photo is out (default 2)')
  .option('--trips <slugs>', 'comma-separated trip slugs to include (new session only)')
  .option('--reset', 'discard the saved session and start over')
  .option('--results', 'print the current favorites and exit')
  .option('--out <file>', 'also write the finished list as CSV when you exit')
  .option('--port <port>', 'local server port', '4519')
  .option('--no-open', "don't open the browser")
  .action(run(favorites));

program.parseAsync(process.argv);
