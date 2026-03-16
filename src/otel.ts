import Openlit from "openlit"
import { trace } from "@opentelemetry/api"

Openlit.init({
  applicationName: "fhir-copilot",
  environment: process.env.NODE_ENV ?? "development",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
  otlpHeaders: process.env.OTEL_EXPORTER_OTLP_HEADERS,
  traceContent: true,
})

export const tracer = trace.getTracer("fhir-copilot")
