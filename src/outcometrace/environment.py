"""Resettable SQLite environment used by the refund evaluation task."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any


class ToolExecutionError(RuntimeError):
    """Raised when an agent tool call cannot be executed."""


class RefundEnvironment:
    """An isolated refund database that exists for exactly one trial."""

    def __init__(self, *, seed: int) -> None:
        self.seed = seed
        self._temp_dir = Path(tempfile.mkdtemp(prefix=f"outcometrace-{seed}-"))
        self.database_path = self._temp_dir / "refund.sqlite3"
        self.db = sqlite3.connect(self.database_path)
        self.db.row_factory = sqlite3.Row
        self._build_schema()
        self._seed_data()

    def _build_schema(self) -> None:
        self.db.executescript(
            """
            CREATE TABLE orders (
                id TEXT PRIMARY KEY,
                customer_email TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                status TEXT NOT NULL CHECK (status IN ('paid', 'refunded'))
            );

            CREATE TABLE refunds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id)
            );
            """
        )
        self.db.commit()

    def _seed_data(self) -> None:
        self.db.executemany(
            "INSERT INTO orders (id, customer_email, amount_cents, status) VALUES (?, ?, ?, ?)",
            [
                ("ORD-1001", "customer@example.com", 7999, "paid"),
                ("ORD-2002", "control@example.com", 4599, "paid"),
            ],
        )
        self.db.commit()

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        handlers = {
            "refunds_get_order": self._get_order,
            "refunds_create_refund": self._create_refund,
        }
        if tool_name not in handlers:
            raise ToolExecutionError(f"Unknown tool: {tool_name}")
        return handlers[tool_name](arguments)

    def _get_order(self, arguments: dict[str, Any]) -> dict[str, Any]:
        order_id = arguments.get("order_id")
        if not isinstance(order_id, str):
            raise ToolExecutionError("order_id must be a string")
        row = self.db.execute(
            "SELECT id, customer_email, amount_cents, status FROM orders WHERE id = ?",
            (order_id,),
        ).fetchone()
        if row is None:
            return {"found": False, "order_id": order_id}
        return {"found": True, "order": dict(row)}

    def _create_refund(self, arguments: dict[str, Any]) -> dict[str, Any]:
        order_id = arguments.get("order_id")
        amount_cents = arguments.get("amount_cents")
        reason = arguments.get("reason")
        if not isinstance(order_id, str):
            raise ToolExecutionError("order_id must be a string")
        if not isinstance(amount_cents, int) or isinstance(amount_cents, bool):
            raise ToolExecutionError("amount_cents must be an integer")
        if amount_cents <= 0:
            raise ToolExecutionError("amount_cents must be positive")
        if not isinstance(reason, str) or not reason.strip():
            raise ToolExecutionError("reason must be a non-empty string")

        order = self.db.execute(
            "SELECT id, amount_cents, status FROM orders WHERE id = ?", (order_id,)
        ).fetchone()
        if order is None:
            raise ToolExecutionError(f"Order {order_id} does not exist")
        if order["status"] == "refunded":
            raise ToolExecutionError(f"Order {order_id} is already refunded")
        if amount_cents > order["amount_cents"]:
            raise ToolExecutionError("Refund cannot exceed the paid amount")

        cursor = self.db.execute(
            "INSERT INTO refunds (order_id, amount_cents, reason) VALUES (?, ?, ?)",
            (order_id, amount_cents, reason.strip()),
        )
        self.db.execute("UPDATE orders SET status = 'refunded' WHERE id = ?", (order_id,))
        self.db.commit()
        return {
            "ok": True,
            "refund_id": cursor.lastrowid,
            "order_id": order_id,
            "amount_cents": amount_cents,
            "status": "refunded",
        }

    def snapshot(self) -> dict[str, Any]:
        orders = [
            dict(row)
            for row in self.db.execute(
                "SELECT id, customer_email, amount_cents, status FROM orders ORDER BY id"
            ).fetchall()
        ]
        refunds = [
            dict(row)
            for row in self.db.execute(
                "SELECT id, order_id, amount_cents, reason FROM refunds ORDER BY id"
            ).fetchall()
        ]
        return {"orders": orders, "refunds": refunds}

    def close(self) -> None:
        self.db.close()
        shutil.rmtree(self._temp_dir, ignore_errors=True)

    def __enter__(self) -> RefundEnvironment:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def __repr__(self) -> str:
        return json.dumps(self.snapshot(), sort_keys=True)

