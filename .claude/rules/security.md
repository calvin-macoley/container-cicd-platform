# Security rules
- Never hardcode secrets, tokens, or passwords. Use env vars and document them in .env.example.
- Never read or modify .env files or Ansible vault files.
- Never run commands that change remote infrastructure (terraform apply, ansible-playbook, docker push, git push).
- Containers run as non-root. Pin base image versions.
