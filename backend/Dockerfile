# ---- build stage ----
FROM golang:1.25.3-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /cmt-backend .

# ---- runtime stage ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /cmt-backend .
EXPOSE 8080
CMD ["./cmt-backend"]
