import type { Command } from "commander";
import chalk from "chalk";
import { FilesystemSkillManager, getBundledSkillsDir } from "@ants/agent-skills-loader";

export function registerSkillCommands(program: Command): void {
  const skillCmd = program
    .command("skill")
    .description("Skill management");

  skillCmd
    .command("list")
    .description("List available skills")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .action(async (options) => {
      // Get bundled skills path
      const bundledSkillsPath = getBundledSkillsDir();
      
      const manager = new FilesystemSkillManager(options.directory, {
        additionalBundledPaths: [bundledSkillsPath],
      });
      await manager.discover();

      const warnings = manager.getOverrideWarnings();
      for (const warning of warnings) {
        console.log(chalk.yellow(`Warning: ${warning}`));
      }
      if (warnings.length > 0) {
        console.log();
      }

      const skills = manager.getAvailable();

      if (options.json) {
        console.log(JSON.stringify({ skills }, null, 2));
        return;
      }

      if (skills.length === 0) {
        console.log(chalk.gray("No skills available."));
        console.log(chalk.gray("\nSkill locations:"));
        const paths = manager.getPaths();
        console.log(chalk.gray(`  Local:   ${paths.local}`));
        console.log(chalk.gray(`  Global:  ${paths.global}`));
        console.log(chalk.gray(`  Bundled: ${paths.bundled}`));
        if (paths.additionalBundled.length > 0) {
          console.log(chalk.gray(`  Plugin:  ${paths.additionalBundled.join(", ")}`));
        }
        return;
      }

      console.log(chalk.cyan(`Available skills (${skills.length}):\n`));

      const bySource = new Map<string, typeof skills>();
      for (const skill of skills) {
        const existing = bySource.get(skill.source) ?? [];
        existing.push(skill);
        bySource.set(skill.source, existing);
      }

      const sourceLabels = {
        local: "Project Skills (.ants/skills/)",
        global: "Global Skills (~/.config/ants/skills/)",
        bundled: "Bundled Skills",
      };

      for (const [source, sourceSkills] of bySource) {
        console.log(chalk.white(`${sourceLabels[source as keyof typeof sourceLabels]}:`));
        for (const skill of sourceSkills) {
          console.log(`  ${chalk.green(skill.name)}`);
          const desc = skill.description.length > 70
            ? skill.description.slice(0, 70) + "..."
            : skill.description;
          console.log(`    ${chalk.gray(desc)}`);
        }
        console.log();
      }
    });

  skillCmd
    .command("show")
    .description("Show details of a skill")
    .argument("<name>", "Skill name")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .option("--json", "Output as JSON")
    .option("--content", "Show full skill content/instructions")
    .action(async (name, options) => {
      // Get bundled skills path
      const bundledSkillsPath = getBundledSkillsDir();
      
      const manager = new FilesystemSkillManager(options.directory, {
        additionalBundledPaths: [bundledSkillsPath],
      });
      await manager.discover();

      if (!manager.hasSkill(name)) {
        console.error(chalk.red(`Skill not found: ${name}`));
        const available = manager.getAvailable();
        if (available.length > 0) {
          console.log(chalk.gray(`\nAvailable skills: ${available.map((s: { name: string }) => s.name).join(", ")}`));
        }
        process.exit(1);
      }

      const skill = await manager.load(name);

      if (options.json) {
        console.log(JSON.stringify(skill, null, 2));
        return;
      }

      console.log(chalk.cyan("Skill Details:\n"));
      console.log(`  Name:        ${chalk.white(skill.metadata.name)}`);
      console.log(`  Source:      ${chalk.gray(skill.source)}`);
      console.log(`  Path:        ${chalk.gray(skill.path)}`);
      console.log(`  Description: ${chalk.green(skill.metadata.description)}`);

      if (skill.metadata.license) {
        console.log(`  License:     ${chalk.gray(skill.metadata.license)}`);
      }
      if (skill.metadata.compatibility) {
        console.log(`  Compat:      ${chalk.gray(skill.metadata.compatibility)}`);
      }
      if (skill.metadata.allowedTools?.length) {
        console.log(`  Tools:       ${chalk.gray(skill.metadata.allowedTools.join(", "))}`);
      }
      if (skill.metadata.metadata) {
        console.log(`  Metadata:    ${chalk.gray(JSON.stringify(skill.metadata.metadata))}`);
      }

      if (options.content) {
        console.log(chalk.cyan("\nInstructions:\n"));
        console.log(skill.instructions);
      } else {
        const preview = skill.instructions.slice(0, 200);
        const truncated = skill.instructions.length > 200 ? "..." : "";
        console.log(chalk.cyan("\nInstructions Preview:\n"));
        console.log(chalk.gray(preview + truncated));
        console.log(chalk.gray("\nUse --content to show full instructions."));
      }
    });

  skillCmd
    .command("paths")
    .description("Show skill discovery paths")
    .option("-d, --directory <dir>", "Working directory", process.cwd())
    .action(async (options) => {
      // Get bundled skills path
      const bundledSkillsPath = getBundledSkillsDir();
      
      const manager = new FilesystemSkillManager(options.directory, {
        additionalBundledPaths: [bundledSkillsPath],
      });
      const paths = manager.getPaths();

      console.log(chalk.cyan("Skill Discovery Paths (in priority order):\n"));
      console.log(`  1. Project local: ${chalk.white(paths.local)}`);
      console.log(`  2. Global user:   ${chalk.white(paths.global)}`);
      console.log(`  3. Bundled:       ${chalk.white(paths.bundled)}`);
      if (paths.additionalBundled.length > 0) {
        console.log(`  4. Plugin skills: ${chalk.white(paths.additionalBundled.join(", "))}`);
      }
      console.log();
      console.log(chalk.gray("Skills in higher-priority paths override those with the same name in lower-priority paths."));
    });
}
