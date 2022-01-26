# Workflow building blocks

This directory contains big building blocks for workflows.

Block is the regular action with the next differences to one in actions/ dir:
- it performs complex tasks (build the project) contrary to actions/*, which usually do some simple step,
  like calling 'gradle' command or sending message to Telegram.
- it is aware of context (see actions/context) and use it. This means there could be 'hidden' dependencies
  between two blocks, which should never happen between regular actions.

The main idea of blocks is to provide the instrument of building fully custom workflow with repeatable
predefined steps, when 'default' workflow does not meet your needs.

For example, when you want to put some custom action between 'build' and 'test' jobs in your Java project's CI,
you have to copy-paste some basic workflow and modify it in-place.
Blocks give the ability to still get some maintenance simplicity even after that copy-paste thing in out projects.
