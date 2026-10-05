---
name: ansible-role
description: Review an Ansible role the human wrote against project standards.
disable-model-invocation: true
---
# Ansible role review

Do not edit files. Review the role at the path given and report findings on:
- Idempotence (a second run reports zero changes)
- Defaults prefixed with the role name
- Every task named
- Modules preferred over shell/command
- no_log on anything touching secrets
- Molecule scenario present
- ansible-lint clean

Order findings by severity and explain the "why" for each so the human learns.
