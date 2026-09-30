"""Sanjaya (సంజయ), the newsroom assistant inside the admin panel.

Named for the narrator of the Mahabharata who could see the whole battlefield
and reported it to the king as it happened - the newsroom's eyes on its own
numbers, and a pair of hands for the jobs staff would otherwise do one click at
a time. It acts only as the person typing to it, with their permissions.

Importing this package registers every tool and job runner.
"""

from app.services.assistant import jobs, tools_actions, tools_data  # noqa: F401
