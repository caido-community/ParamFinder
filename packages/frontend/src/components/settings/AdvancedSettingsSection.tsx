import { useSettings, useUpdateSettingsField } from "@/stores/settingsStore";
import {
  Box,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback } from "react";
import { AnomalyType } from "shared";
import { EmptyPanel } from "../common/EmptyPanel";

export const AdvancedSettingsSection = () => {
  const { data: settings, isLoading } = useSettings();
  const updateSettingsField = useUpdateSettingsField();

  const toggleSetting = useCallback(
    (field: keyof typeof settings) =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        updateSettingsField({
          [field]: e.target.checked,
        });
      },
    [settings, updateSettingsField]
  );

  const handleAutoDetectMaxSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateSettingsField({
        autoDetectMaxSize: e.target.checked,
        maxQuerySize: e.target.checked ? undefined : settings.maxQuerySize,
        maxHeaderSize: e.target.checked ? undefined : settings.maxHeaderSize,
        maxBodySize: e.target.checked ? undefined : settings.maxBodySize,
      });
    },
    [settings, updateSettingsField]
  );

  if (isLoading) return <EmptyPanel message="Loading settings..." />;

  return (
    <Paper sx={{ p: 4, flex: 1 }}>
      <Typography variant="h6" gutterBottom sx={{ mb: 3, fontWeight: 500 }}>
        Advanced Settings
      </Typography>

      <Stack spacing={1}>
        <Box key="autoDetectMaxSize">
          <Tooltip
            title="Automatically detect maximum request size limits based on server responses"
            placement="right"
          >
            <FormControlLabel
              control={
                <Switch
                  checked={settings.autoDetectMaxSize}
                  onChange={handleAutoDetectMaxSizeChange}
                />
              }
              label="Auto Detect Max Request Size"
            />
          </Tooltip>
        </Box>

        {!settings.autoDetectMaxSize && (
          <Stack direction="row" spacing={2}>
            <TextField
              label="Max URL Size"
              type="number"
              helperText="Maximum size of URL server can handle at a time"
              value={settings.maxQuerySize ?? ""}
              onChange={(e) =>
                updateSettingsField({
                  maxQuerySize: Number(e.target.value),
                })
              }
              sx={{ flex: 1, minWidth: "250px" }}
            />

            <TextField
              label="Max Header Size"
              type="number"
              helperText="Maximum size of headers server can handle at a time"
              value={settings.maxHeaderSize ?? ""}
              onChange={(e) =>
                updateSettingsField({
                  maxHeaderSize: Number(e.target.value),
                })
              }
              sx={{ flex: 1, minWidth: "250px" }}
            />

            <TextField
              label="Max Body Size"
              type="number"
              helperText="Maximum size of body server can handle at a time"
              value={settings.maxBodySize ?? ""}
              onChange={(e) =>
                updateSettingsField({
                  maxBodySize: Number(e.target.value),
                })
              }
              sx={{ flex: 1, minWidth: "250px" }}
            />
          </Stack>
        )}

        {[
          {
            field: "wafDetection" as const,
            label: "WAF Detection",
            tooltip: "Automatically detect and adjust to WAFs",
          },
          {
            field: "additionalChecks" as const,
            label: "Additional Checks",
            tooltip:
              "Perform additional learning checks to prevent false positives",
          },
          {
            field: "autopilotEnabled" as const,
            label: "Autopilot Feature",
            tooltip:
              "Automatically adjust settings based on target response as we go",
          },
          {
            field: "updateContentLength" as const,
            label: "Update Content-Length",
            tooltip:
              "Automatically update Content-Length header when modifying requests",
          },
          {
            field: "debug" as const,
            label: "Debug Mode (extensive logging)",
            tooltip: "Enable detailed logging for troubleshooting",
          },
          {
            field: "performanceMode" as const,
            label: "Performance Mode",
            tooltip:
              "Only receive findings, omit request data to reduce memory usage",
          },
          {
            field: "addCacheBusterParameter" as const,
            label: "Always Add Cache Buster Parameter",
            tooltip:
              "Always add a cache buster parameter to the request for headers & query attack",
          },
        ].map(({ field, label, tooltip }) => (
          <Box key={field}>
            <Tooltip title={tooltip} placement="right">
              <FormControlLabel
                control={
                  <Switch
                    checked={settings[field]}
                    onChange={toggleSetting(field)}
                  />
                }
                label={label}
              />
            </Tooltip>
          </Box>
        ))}

        <FormControl fullWidth>
          <InputLabel id="ignore-anomaly-types-label">
            Anomaly Types To Ignore
          </InputLabel>
          <Select
            labelId="ignore-anomaly-types-label"
            multiple
            value={settings.ignoreAnomalyTypes}
            onChange={(e) =>
              updateSettingsField({
                ignoreAnomalyTypes: e.target.value as AnomalyType[],
              })
            }
            input={<OutlinedInput label="Anomaly Types To Ignore" />}
            renderValue={(selected) => (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {(selected as AnomalyType[]).map((value) => (
                  <Chip key={value} label={value} />
                ))}
              </Box>
            )}
          >
            {Object.values(AnomalyType).map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary">
          Some targets may exhibit unusual behavior that triggers false
          positives. Use this setting to ignore specific anomaly types.
        </Typography>
      </Stack>
    </Paper>
  );
};
