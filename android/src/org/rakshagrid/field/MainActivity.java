package org.rakshagrid.field;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.CaptureFailure;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.widget.*;
import android.util.Base64;
import android.util.Size;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
  private static final int INK=0xff153447,GREEN=0xff087f72,MUTED=0xff647988;
  private static final int NOTIFICATION_PERMISSION_REQUEST=42;
  private static final int LIVE_PERMISSION_REQUEST=43;
  private static final String ALERT_CHANNEL="raksha_status_alerts";
  private static final Object QUEUE_LOCK=new Object();
  private SharedPreferences prefs;
  private final Handler handler=new Handler(Looper.getMainLooper());
  private final ExecutorService worker=Executors.newSingleThreadExecutor();
  private final ExecutorService liveExecutor=Executors.newSingleThreadExecutor();
  private LinearLayout content,pairPanel,reportPanel,history;
  private LinearLayout livePanel;
  private TextView liveStatus;
  private Button stopLiveButton;
  private EditText address,code,name,message,landmark;
  private Spinner type;
  private TextView connection,gpsStatus;
  private Button send,pair,updateAddress;
  private String server="",token="";
  private boolean working=false,resumed=false;
  private JSONObject coordinates=null;
  private long coordinatesAt=0;
  private SensorManager sensorManager;
  private Sensor accelerometer;
  private CheckBox shakeToggle,fallToggle;
  private boolean shakeEnabled=false,fallEnabled=false,sensorRegistered=false,emergencyPending=false;
  private long shakeWindowStart=0,lastShakeAt=0,lastAutoTriggerAt=0,freeFallAt=0;
  private int shakeCount=0,countdownRemaining=0;
  private String pendingTriggerReason="";
  private AlertDialog emergencyDialog;
  private ToneGenerator toneGenerator;
  private Vibrator vibrator;
  private CameraDevice liveCamera;
  private CameraCaptureSession liveCameraSession;
  private ImageReader liveImageReader;
  private AudioRecord liveAudioRecord;
  private Thread liveAudioThread;
  private volatile boolean liveActive=false,liveCheckBusy=false;
  private volatile String liveSessionId="",liveIncidentId="";
  private JSONObject pendingLiveApproval;
  private String pendingPermissionIncidentId="";
  private AlertDialog liveApprovalDialog;
  private AlertDialog liveConsentDialog;
  private final ArrayList<String> liveConsentQueue=new ArrayList<>();
  private final Set<String> promptedLiveConsents=new HashSet<>();
  private final Set<String> liveConsentedIncidents=new HashSet<>();
  private final Set<String> promptedLiveSessions=new HashSet<>();
  private final SensorEventListener motionListener=new SensorEventListener(){
    public void onSensorChanged(SensorEvent event){if(event.sensor.getType()==Sensor.TYPE_ACCELEROMETER)handleMotion(event.values,System.currentTimeMillis());}
    public void onAccuracyChanged(Sensor sensor,int accuracy){}
  };
  private final Runnable countdownTick=new Runnable(){public void run(){
    if(!emergencyPending||emergencyDialog==null)return;
    if(countdownRemaining<=0){
      AlertDialog dialog=emergencyDialog;emergencyDialog=null;emergencyPending=false;stopEmergencyAlarm();dialog.dismiss();queueAutomaticSos(pendingTriggerReason);
    }else{
      emergencyDialog.setMessage("Possible emergency detected. SOS sends in "+countdownRemaining+" seconds unless you cancel.");
      if(countdownRemaining%2==0)beepAndVibrate();countdownRemaining--;handler.postDelayed(this,1000);
    }
  }};
  private LocationManager locationManager;
  private LocationListener locationListener;
  private final Runnable poll=new Runnable(){public void run(){if(resumed){sync();handler.postDelayed(this,8000);}}};
  private final Runnable livePoll=new Runnable(){public void run(){if(resumed){checkLiveRequests();handler.postDelayed(this,2000);}}};

  @Override public void onCreate(Bundle saved){
    super.onCreate(saved);prefs=getSharedPreferences("raksha-field",MODE_PRIVATE);server=prefs.getString("server","");token=prefs.getString("token","");try{JSONArray savedConsents=new JSONArray(prefs.getString("liveConsentIncidents","[]"));for(int i=0;i<savedConsents.length();i++)liveConsentedIncidents.add(savedConsents.optString(i));}catch(Exception ignored){}
    shakeEnabled=prefs.getBoolean("shakeEnabled",false);fallEnabled=prefs.getBoolean("fallEnabled",false);
    sensorManager=(SensorManager)getSystemService(SENSOR_SERVICE);accelerometer=sensorManager==null?null:sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
    vibrator=(Vibrator)getSystemService(VIBRATOR_SERVICE);createNotificationChannel();
    ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(0xfff1f5f7);
    content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(24),dp(28),dp(24),dp(30));scroll.addView(content);setContentView(scroll);
    scroll.setOnApplyWindowInsetsListener((v,insets)->{content.setPadding(dp(24)+insets.getSystemWindowInsetLeft(),dp(24)+insets.getSystemWindowInsetTop(),dp(24)+insets.getSystemWindowInsetRight(),dp(24)+insets.getSystemWindowInsetBottom());return insets;});
    text(content,"RAKSHA / FIELD",12,GREEN,true);text(content,"Reach your headquarters",28,INK,true);text(content,"Send a report. Track delivery. Get acknowledgement.",14,MUTED,false);
    connection=text(content,token.isEmpty()?"Pair this phone to start.":"Checking headquarters…",13,GREEN,true);
    pairPanel=panel();text(pairPanel,"Connect to headquarters",20,INK,true);text(pairPanel,"Ask your operator for the HTTPS server address and pairing code.",13,MUTED,false);
    address=input(pairPanel,"Server address", "https://your-server.trycloudflare.com",true);address.setText(server);address.setInputType(17);
    name=input(pairPanel,"Your name or device name","e.g. Manvesh · Phone 1",true);name.setText(prefs.getString("name",""));
    code=input(pairPanel,"Pairing code","16-character code from headquarters",true);code.setInputType(1|0x80000);
    pair=button(pairPanel,"Pair this phone",GREEN);pair.setOnClickListener(v->pairPhone());
    updateAddress=button(pairPanel,"Update address only",0xff47667a);updateAddress.setVisibility(token.isEmpty()?View.GONE:View.VISIBLE);updateAddress.setOnClickListener(v->{try{if(working)throw new Exception("Wait for the current request to finish.");server=validAddress(address.getText().toString());prefs.edit().putString("server",server).commit();connection.setText("Address updated. Checking connection…");pairPanel.setVisibility(View.GONE);sync();}catch(Exception e){showError(e.getMessage());}});
    pairPanel.setVisibility(token.isEmpty()?View.VISIBLE:View.GONE);
    reportPanel=panel();text(reportPanel,"Send an alert",21,INK,true);text(reportPanel,"This sends to your chosen headquarters, not public emergency services.",12,MUTED,false);
    text(reportPanel,"What assistance is needed?",12,MUTED,true);type=new Spinner(this);type.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"SOS","Medical","Fire","Flood","Trapped","Other"}));reportPanel.addView(type);
    landmark=input(reportPanel,"Location / landmark","Building, street, floor or nearby landmark",true);
    message=input(reportPanel,"Describe the situation","What happened? How many people need help?",false);message.setMinLines(3);message.setGravity(48);
    Button gps=button(reportPanel,"Attach current GPS location (optional)",0xff47667a);gps.setOnClickListener(v->requestGps());gpsStatus=text(reportPanel,"No GPS attached. A written location is required.",12,MUTED,false);
    send=button(reportPanel,"Send SOS / report",0xffc45136);send.setOnClickListener(v->confirmSend());
    text(reportPanel,"When offline, a report stays on this phone. Keep the app open to retry; reopening the app also retries pending reports.",12,MUTED,false);
    reportPanel.setVisibility(token.isEmpty()?View.GONE:View.VISIBLE);
    livePanel=panel();text(livePanel,"Live response view",18,INK,true);liveStatus=text(livePanel,"Camera and microphone stay off until an HQ request and your approval.",12,MUTED,false);stopLiveButton=button(livePanel,"Stop live sharing",0xffc45136);stopLiveButton.setVisibility(View.GONE);stopLiveButton.setOnClickListener(v->stopLiveCapture("Live sharing stopped by you.",true));
    addEmergencyControls();
    LinearLayout actions=panel();Button retry=button(actions,"Refresh / retry pending reports",GREEN);retry.setOnClickListener(v->sync());Button settings=button(actions,"Connection settings",0xff47667a);settings.setOnClickListener(v->pairPanel.setVisibility(pairPanel.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE));
    history=panel();text(history,"Delivery and responses",20,INK,true);renderHistory(new JSONArray());
  }

  private void addEmergencyControls(){
    LinearLayout sensors=panel();text(sensors,"Emergency alerts",20,INK,true);
    text(sensors,"Shake and fall alerts work only while Raksha Field is open. Each gives you 10 seconds to cancel before sending.",12,MUTED,false);
    shakeToggle=new CheckBox(this);shakeToggle.setText("Shake phone 3 times to trigger SOS");shakeToggle.setTextColor(INK);shakeToggle.setChecked(shakeEnabled);sensors.addView(shakeToggle);
    fallToggle=new CheckBox(this);fallToggle.setText("Possible fall detection (experimental)");fallToggle.setTextColor(INK);fallToggle.setChecked(fallEnabled);sensors.addView(fallToggle);
    shakeToggle.setOnCheckedChangeListener((button,checked)->{shakeEnabled=checked;prefs.edit().putBoolean("shakeEnabled",checked).apply();updateSensorRegistration();});
    fallToggle.setOnCheckedChangeListener((button,checked)->{fallEnabled=checked;prefs.edit().putBoolean("fallEnabled",checked).apply();updateSensorRegistration();});
    Button alerts=button(sensors,"Enable status notifications with sound + vibration",0xff47667a);alerts.setOnClickListener(v->enableStatusNotifications());
    text(sensors,"Shake needs three firm movements. Fall detection checks for a short drop followed by impact; a dropped phone can trigger it. Cancel the countdown if you are okay.",12,MUTED,false);
  }

  private void updateSensorRegistration(){
    if(sensorManager==null||accelerometer==null){if(shakeToggle!=null&&shakeToggle.isChecked())shakeToggle.setChecked(false);if(fallToggle!=null&&fallToggle.isChecked())fallToggle.setChecked(false);shakeEnabled=false;fallEnabled=false;prefs.edit().putBoolean("shakeEnabled",false).putBoolean("fallEnabled",false).apply();if(connection!=null)connection.setText("Motion sensor unavailable. Use the Send SOS button.");return;}
    boolean shouldListen=resumed&&(shakeEnabled||fallEnabled);
    if(shouldListen&&!sensorRegistered)sensorRegistered=sensorManager.registerListener(motionListener,accelerometer,SensorManager.SENSOR_DELAY_GAME,handler);
    else if(!shouldListen&&sensorRegistered){sensorManager.unregisterListener(motionListener);sensorRegistered=false;}
  }

  private void handleMotion(float[] values,long now){
    if(values==null||values.length<3||emergencyPending||now-lastAutoTriggerAt<12000)return;
    double magnitude=Math.sqrt(values[0]*values[0]+values[1]*values[1]+values[2]*values[2]);
    if(fallEnabled){
      if(magnitude<2.6)freeFallAt=now;
      else if(freeFallAt>0){long gap=now-freeFallAt;if(gap>80&&gap<1700&&magnitude>21.5){freeFallAt=0;lastAutoTriggerAt=now;beginEmergencyCountdown("Possible fall detected");return;}if(gap>=1700)freeFallAt=0;}
    }
    if(shakeEnabled){
      double motion=Math.abs(magnitude-9.80665);
      if(motion>4.2&&now-lastShakeAt>250){
        if(now-shakeWindowStart>2200){shakeWindowStart=now;shakeCount=0;}
        if(shakeCount==0)shakeWindowStart=now;shakeCount++;lastShakeAt=now;
        if(shakeCount>=3){shakeCount=0;shakeWindowStart=0;lastAutoTriggerAt=now;beginEmergencyCountdown("Shake detected");}
      }else if(now-shakeWindowStart>2200){shakeCount=0;shakeWindowStart=0;}
    }
  }

  private void beginEmergencyCountdown(String reason){
    if(emergencyPending||isFinishing())return;emergencyPending=true;pendingTriggerReason=reason;countdownRemaining=10;beepAndVibrate();
    emergencyDialog=new AlertDialog.Builder(this).setTitle(reason).setMessage("Possible emergency detected. SOS sends in 10 seconds unless you cancel.")
      .setPositiveButton("Send SOS now",(d,w)->{handler.removeCallbacks(countdownTick);emergencyPending=false;emergencyDialog=null;stopEmergencyAlarm();queueAutomaticSos(reason);})
      .setNegativeButton("I'm okay — cancel",(d,w)->{handler.removeCallbacks(countdownTick);emergencyPending=false;emergencyDialog=null;stopEmergencyAlarm();if(connection!=null)connection.setText("Automatic SOS canceled.");}).create();
    emergencyDialog.setCancelable(false);emergencyDialog.setCanceledOnTouchOutside(false);emergencyDialog.show();handler.postDelayed(countdownTick,1000);
  }

  private void queueAutomaticSos(String reason){
    try{
      String place=landmark==null?"":landmark.getText().toString().trim();if(place.length()<2)place="Location unavailable — automatic SOS";
      JSONObject alert=new JSONObject().put("requestId",UUID.randomUUID().toString()).put("type","SOS").put("message",reason+" — automatic phone alert").put("location",place);
      if(coordinates!=null&&System.currentTimeMillis()-coordinatesAt<120000)alert.put("coordinates",coordinates);
      synchronized(QUEUE_LOCK){JSONArray queue=pending();if(queue.length()>=50)throw new IOException("50 reports are pending. Reconnect before sending more.");queue.put(alert);savePending(queue);}
      connection.setText("Automatic SOS saved on phone. Waiting for HQ receipt…");connection.setTextColor(0xffaa432c);renderHistory(new JSONArray(prefs.getString("history","[]")));sync();
      postLocalNotification("Automatic SOS started",reason+" · checking HQ receipt",(int)(System.currentTimeMillis()%Integer.MAX_VALUE));
    }catch(Exception e){if(connection!=null)connection.setText("Automatic SOS could not be saved: "+e.getMessage());showError("Automatic SOS could not be saved. Use Send SOS and retry.");}
  }

  private void beepAndVibrate(){
    try{if(toneGenerator==null)toneGenerator=new ToneGenerator(AudioManager.STREAM_ALARM,90);toneGenerator.startTone(ToneGenerator.TONE_PROP_BEEP,220);}catch(Exception ignored){}
    try{if(vibrator!=null&&vibrator.hasVibrator()){if(Build.VERSION.SDK_INT>=26)vibrator.vibrate(VibrationEffect.createOneShot(240,VibrationEffect.DEFAULT_AMPLITUDE));else vibrator.vibrate(240);}}catch(Exception ignored){}
  }

  private void stopEmergencyAlarm(){
    try{if(toneGenerator!=null)toneGenerator.stopTone();}catch(Exception ignored){}
    try{if(vibrator!=null)vibrator.cancel();}catch(Exception ignored){}
  }

  private void createNotificationChannel(){
    if(Build.VERSION.SDK_INT<26)return;NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);if(manager==null)return;
    NotificationChannel channel=new NotificationChannel(ALERT_CHANNEL,"Raksha Field status alerts",NotificationManager.IMPORTANCE_HIGH);channel.setDescription("Sound and vibration when headquarters updates a report.");channel.enableVibration(true);channel.setVibrationPattern(new long[]{0,250,180,250});channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION).build());manager.createNotificationChannel(channel);
  }

  private void enableStatusNotifications(){
    if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATION_PERMISSION_REQUEST);return;}
    prefs.edit().putBoolean("statusNotifications",true).apply();showError("Status notifications are enabled with sound and vibration.");
  }

  private boolean canNotify(){
    if(!prefs.getBoolean("statusNotifications",false))return false;
    return Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
  }

  private void postLocalNotification(String title,String detail,int id){
    if(!canNotify())return;try{
      NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);if(manager==null)return;
      Intent intent=new Intent(this,MainActivity.class);intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
      PendingIntent open=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      Notification notification=new Notification.Builder(this,ALERT_CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(detail).setStyle(new Notification.BigTextStyle().bigText(detail)).setContentIntent(open).setAutoCancel(true).build();
      manager.notify(id,notification);
    }catch(SecurityException ignored){}
  }

  private void notifyStatusChanges(JSONArray reports){
    try{
      JSONObject previous=new JSONObject(prefs.getString("knownReportStatuses","{}")),current=new JSONObject();boolean baseline=prefs.getBoolean("statusBaseline",false);
      for(int i=0;i<reports.length();i++){JSONObject alert=reports.optJSONObject(i);if(alert==null)continue;String id=alert.optString("id"),status=alert.optString("status");if(id.isEmpty())continue;
        String old=previous.optString(id,"");if(baseline&&!old.isEmpty()&&!old.equals(status))postLocalNotification("HQ update · "+status,alert.optString("type","SOS")+" · "+alert.optString("location",""),id.hashCode());current.put(id,status);
      }
      prefs.edit().putString("knownReportStatuses",current.toString()).putBoolean("statusBaseline",true).apply();
    }catch(Exception ignored){}
  }

  private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
  private LinearLayout panel(){LinearLayout p=new LinearLayout(this);p.setOrientation(1);p.setPadding(dp(17),dp(17),dp(17),dp(17));p.setBackgroundColor(Color.WHITE);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(18);content.addView(p,lp);return p;}
  private TextView text(LinearLayout parent,String value,int size,int color,boolean bold){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);if(bold)v.setTypeface(null,1);v.setPadding(0,dp(5),0,dp(8));parent.addView(v);return v;}
  private EditText input(LinearLayout parent,String label,String hint,boolean single){text(parent,label,12,MUTED,true);EditText v=new EditText(this);v.setHint(hint);v.setTextColor(INK);v.setTextSize(15);v.setSingleLine(single);v.setPadding(dp(8),dp(10),dp(8),dp(10));parent.addView(v,new LinearLayout.LayoutParams(-1,-2));return v;}
  private Button button(LinearLayout parent,String label,int color){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextColor(Color.WHITE);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(color));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.topMargin=dp(9);parent.addView(b,lp);return b;}
  private void showError(String message){new AlertDialog.Builder(this).setTitle("Raksha Field").setMessage(message).setPositiveButton("OK",null).show();}
  private JSONArray pending(){try{return new JSONArray(prefs.getString("pending","[]"));}catch(Exception e){throw new IllegalStateException("Saved reports cannot be read. Do not clear app data.",e);}}
  private void savePending(JSONArray items)throws IOException{if(!prefs.edit().putString("pending",items.toString()).commit())throw new IOException("Could not save the report on this phone.");}
  private String validAddress(String value)throws Exception{
    URI u=new URI(value.trim());String host=u.getHost();if(host==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!(u.getPath().isEmpty()||u.getPath().equals("/")))throw new Exception("Enter the server address only, without a path.");
    boolean ipv4=host.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}");
    if(ipv4)for(String part:host.split("\\."))if(Integer.parseInt(part)>255)ipv4=false;
    boolean local=host.equals("localhost")||(ipv4&&(host.startsWith("127.")||host.startsWith("10.")||host.startsWith("192.168.")||host.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..*")));
    if(!u.getScheme().equals("https")&&!(u.getScheme().equals("http")&&local))throw new Exception("Use HTTPS for an internet server. HTTP is allowed only for a local network address.");
    return u.getScheme()+"://"+u.getRawAuthority();
  }
  private JSONObject request(String base,String auth,String path,String method,JSONObject payload)throws Exception{
    HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();c.setConnectTimeout(9000);c.setReadTimeout(12000);c.setInstanceFollowRedirects(false);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");
    if(!auth.isEmpty())c.setRequestProperty("Authorization","Bearer "+auth);
    try{
      if(payload!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(payload.toString().getBytes(StandardCharsets.UTF_8));}}
      int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();StringBuilder data=new StringBuilder();
      if(stream!=null)try(BufferedReader reader=new BufferedReader(new InputStreamReader(stream,StandardCharsets.UTF_8))){char[] buf=new char[2048];int count;while((count=reader.read(buf))!=-1){data.append(buf,0,count);if(data.length()>2_000_000)throw new IOException("Response was too large.");}}
      JSONObject result;try{result=new JSONObject(data.toString());}catch(Exception e){throw new IOException("Server unavailable or address changed. Check the address with headquarters.");}
      if(status<200||status>=300)throw new IOException(result.optString("error","Server rejected the request ("+status+")."));return result;
    }finally{c.disconnect();}
  }
  private void pairPhone(){
    if(working)return;
    try{
      String base=validAddress(address.getText().toString()),deviceName=name.getText().toString().trim(),pairCode=code.getText().toString().trim().toLowerCase();
      if(deviceName.length()<2||deviceName.length()>60)throw new Exception("Enter a device name between 2 and 60 characters.");
      if(!pairCode.matches("[a-f0-9]{16}"))throw new Exception("Enter the 16-character pairing code.");
      String installationId=prefs.getString("installationId","");if(installationId.isEmpty()){installationId=UUID.randomUUID().toString();if(!prefs.edit().putString("installationId",installationId).commit())throw new IOException("Could not save phone identity.");}
      JSONObject body=new JSONObject().put("name",deviceName).put("code",pairCode).put("installationId",installationId);working=true;pair.setEnabled(false);connection.setText("Pairing with headquarters…");
      worker.execute(()->{try{JSONObject response=request(base,"","/api/field/pair","POST",body);String nextToken=response.getString("token"),deviceId=response.getString("id");if(pending().length()>0&&!prefs.getString("deviceId",deviceId).equals(deviceId))throw new IOException("Pending reports belong to a different headquarters. Restore its server address first.");if(!prefs.edit().putString("server",base).putString("token",nextToken).putString("name",deviceName).putString("deviceId",deviceId).commit())throw new IOException("Could not save pairing.");runOnUiThread(()->{server=base;token=nextToken;working=false;pair.setEnabled(true);updateAddress.setVisibility(View.VISIBLE);pairPanel.setVisibility(View.GONE);reportPanel.setVisibility(View.VISIBLE);connection.setText("Paired. Headquarters can now receive your reports.");sync();});}catch(Exception e){runOnUiThread(()->{working=false;pair.setEnabled(true);connection.setText("Pairing failed.");showError(e.getMessage());});}});
    }catch(Exception e){showError(e.getMessage());}
  }
  private void confirmSend(){
    if(token.isEmpty()){showError("Pair this phone before sending a report.");return;}
    String msg=message.getText().toString().trim(),place=landmark.getText().toString().trim();
    if(msg.length()<3||msg.length()>1000||place.length()<2||place.length()>200){showError("Enter a location (2–200 characters) and message (3–1,000 characters).");return;}
    new AlertDialog.Builder(this).setTitle("Send report to headquarters?").setMessage("Location: "+place+"\n\n"+msg).setNegativeButton("Cancel",null).setPositiveButton("Send report",(dialog,which)->{
      try{synchronized(QUEUE_LOCK){JSONArray queue=pending();if(queue.length()>=50)throw new Exception("50 reports are pending. Reconnect before sending more.");JSONObject alert=new JSONObject().put("requestId",UUID.randomUUID().toString()).put("type",type.getSelectedItem().toString()).put("message",msg).put("location",place);if(coordinates!=null&&System.currentTimeMillis()-coordinatesAt<120000)alert.put("coordinates",coordinates);queue.put(alert);savePending(queue);}message.setText("");coordinates=null;gpsStatus.setText("No GPS attached. Tap GPS again for your next report.");connection.setText("Saved on phone. Waiting for server receipt…");renderHistory(new JSONArray(prefs.getString("history","[]")));sync();}catch(Exception e){showError(e.getMessage());}
    }).show();
  }
  private void sync(){
    if(working||token.isEmpty()||server.isEmpty())return;working=true;String base=server,auth=token;
    worker.execute(()->{String failure=null;JSONArray reports=null;ArrayList<String> newlyReceivedSos=new ArrayList<>();
      try{JSONArray queue=pending();while(queue.length()>0){JSONObject outgoing=queue.getJSONObject(0),receipt=request(base,auth,"/api/field/alerts","POST",outgoing);if(!receipt.has("id")||!receipt.optString("requestId").equals(outgoing.getString("requestId")))throw new IOException("Server receipt was invalid. Report remains pending.");if("SOS".equals(outgoing.optString("type"))&&!newlyReceivedSos.contains(receipt.optString("id")))newlyReceivedSos.add(receipt.optString("id"));synchronized(QUEUE_LOCK){JSONArray current=pending(),rest=new JSONArray();for(int i=0;i<current.length();i++)if(!current.getJSONObject(i).getString("requestId").equals(outgoing.getString("requestId")))rest.put(current.get(i));savePending(rest);queue=rest;}}reports=request(base,auth,"/api/field/alerts","GET",null).getJSONArray("alerts");prefs.edit().putString("history",reports.toString()).commit();notifyStatusChanges(reports);}
      catch(Exception e){failure=e.getMessage();}
      final String error=failure;final JSONArray result=reports;final ArrayList<String> liveConsentItems=new ArrayList<>(newlyReceivedSos);
      runOnUiThread(()->{working=false;send.setEnabled(true);if(isFinishing())return;if(error==null){connection.setText("Connected · server receipts are up to date");connection.setTextColor(GREEN);}else{connection.setText((pending().length()>0?"NOT DELIVERED · saved on phone. ":"Connection unavailable. ")+error);connection.setTextColor(0xffaa432c);}try{renderHistory(result!=null?result:new JSONArray(prefs.getString("history","[]")));}catch(Exception e){showError("Unable to read report history.");}for(String incidentId:liveConsentItems)enqueueLiveConsent(incidentId);});
    });
  }
  private void renderHistory(JSONArray reports){
    history.removeAllViews();text(history,"Delivery and responses",20,INK,true);JSONArray queue=pending();
    for(int i=queue.length()-1;i>=0;i--){JSONObject a=queue.optJSONObject(i);if(a!=null){text(history,"PENDING · not delivered",13,0xffbd4b2e,true);text(history,a.optString("message")+"\n"+a.optString("location"),14,INK,false);}}
    for(int i=0;i<Math.min(reports.length(),20);i++){JSONObject a=reports.optJSONObject(i);if(a==null)continue;String status=a.optString("status");text(history,status.equals("Received")?"RECEIVED BY SERVER · awaiting operator":status.toUpperCase(),13,GREEN,true);text(history,a.optString("type")+" · "+a.optString("message"),15,INK,true);text(history,a.optString("location")+"\n"+a.optString("updatedAt")+"\nID "+a.optString("id").substring(0,Math.min(8,a.optString("id").length())),12,MUTED,false);}
    if(queue.length()==0&&reports.length()==0)text(history,"No reports yet. Send a test report with your operator before relying on this connection.",13,MUTED,false);
  }
  private boolean hasLivePermissions(){return checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;}
  private boolean hasLiveConsent(String incidentId){return liveConsentedIncidents.contains(incidentId);}
  private void saveLiveConsent(String incidentId){if(incidentId==null||incidentId.isEmpty())return;liveConsentedIncidents.add(incidentId);JSONArray saved=new JSONArray();for(String id:liveConsentedIncidents)saved.put(id);prefs.edit().putString("liveConsentIncidents",saved.toString()).apply();}
  private void enqueueLiveConsent(String incidentId){if(incidentId==null||incidentId.isEmpty()||hasLiveConsent(incidentId)||promptedLiveConsents.contains(incidentId)||liveConsentQueue.contains(incidentId))return;liveConsentQueue.add(incidentId);showNextLiveConsent();}
  private void showNextLiveConsent(){
    if(!resumed||liveConsentDialog!=null||liveConsentQueue.isEmpty())return;String incidentId=liveConsentQueue.remove(0);if(hasLiveConsent(incidentId)){showNextLiveConsent();return;}promptedLiveConsents.add(incidentId);
    liveConsentDialog=new AlertDialog.Builder(this).setTitle("Allow live camera and microphone?")
      .setMessage("HQ received your SOS. Allow camera and microphone access for this SOS? They stay off unless an operator requests a live view. Raksha Field must remain open; you can stop sharing at any time.")
      .setPositiveButton("Allow for this SOS",(d,w)->{liveConsentDialog=null;pendingPermissionIncidentId=incidentId;requestLivePermissions();})
      .setNegativeButton("Not now",(d,w)->{liveConsentDialog=null;showNextLiveConsent();})
      .setOnCancelListener(d->{liveConsentDialog=null;showNextLiveConsent();}).create();
    liveConsentDialog.setCanceledOnTouchOutside(false);liveConsentDialog.show();
  }
  private boolean knowsIncident(String incidentId){try{JSONArray reports=new JSONArray(prefs.getString("history","[]"));for(int i=0;i<reports.length();i++)if(incidentId.equals(reports.optJSONObject(i)==null?"":reports.optJSONObject(i).optString("id")))return true;}catch(Exception ignored){}return false;}
  private void checkLiveRequests(){
    if(liveCheckBusy||token.isEmpty()||server.isEmpty()||!resumed)return;liveCheckBusy=true;final String base=server,auth=token;
    worker.execute(()->{try{JSONArray requests=request(base,auth,"/api/field/live/requests","GET",null).getJSONArray("requests");runOnUiThread(()->handleLiveRequests(requests));}catch(Exception ignored){}finally{liveCheckBusy=false;}});
  }
  private void handleLiveRequests(JSONArray requests){
    if(!resumed)return;
    for(int i=0;i<requests.length();i++){
      JSONObject item=requests.optJSONObject(i);if(item==null)continue;String id=item.optString("sessionId"),incident=item.optString("incidentId"),state=item.optString("state");
      if(id.isEmpty()||incident.isEmpty())continue;
      if(id.equals(liveSessionId)&&!state.equals("active")){stopLiveCapture("HQ ended the live view.",false);continue;}
      if(!state.equals("waiting")||!knowsIncident(incident)||id.equals(liveSessionId)||promptedLiveSessions.contains(id)||liveApprovalDialog!=null||liveConsentDialog!=null)continue;
      if(hasLiveConsent(incident)&&hasLivePermissions()){promptedLiveSessions.add(id);liveSessionId=id;liveIncidentId=incident;respondToLive(item,true);continue;}
      showLiveApproval(item);
    }
  }
  private void showLiveApproval(JSONObject item){
    try{pendingLiveApproval=new JSONObject().put("sessionId",item.getString("sessionId")).put("incidentId",item.getString("incidentId"));promptedLiveSessions.add(item.getString("sessionId"));
      liveApprovalDialog=new AlertDialog.Builder(this).setTitle("HQ requested a live view")
        .setMessage("For SOS "+item.getString("incidentId").substring(0,Math.min(8,item.getString("incidentId").length()))+", share camera and microphone with your operator? This works only while Raksha Field stays open, for up to 5 minutes. You can stop at any time.")
        .setPositiveButton("Allow live view",(d,w)->{liveApprovalDialog=null;requestLivePermissions();})
        .setNegativeButton("Decline",(d,w)->{liveApprovalDialog=null;JSONObject approval=pendingLiveApproval;pendingLiveApproval=null;respondToLive(approval,false);})
        .setOnCancelListener(d->{liveApprovalDialog=null;JSONObject approval=pendingLiveApproval;pendingLiveApproval=null;respondToLive(approval,false);}).create();
      liveApprovalDialog.setCanceledOnTouchOutside(false);liveApprovalDialog.show();
    }catch(Exception e){liveApprovalDialog=null;pendingLiveApproval=null;}
  }
  private void requestLivePermissions(){
    if(pendingLiveApproval!=null)pendingPermissionIncidentId=pendingLiveApproval.optString("incidentId");
    if(pendingPermissionIncidentId.isEmpty()&&pendingLiveApproval==null)return;
    if(hasLivePermissions()){saveLiveConsent(pendingPermissionIncidentId);pendingPermissionIncidentId="";JSONObject approval=pendingLiveApproval;pendingLiveApproval=null;if(approval!=null)respondToLive(approval,true);else showNextLiveConsent();return;}
    ArrayList<String> missing=new ArrayList<>();if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)missing.add(Manifest.permission.CAMERA);if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)missing.add(Manifest.permission.RECORD_AUDIO);
    requestPermissions(missing.toArray(new String[0]),LIVE_PERMISSION_REQUEST);
  }
  private void respondToLive(JSONObject approval,boolean accepted){
    if(approval==null)return;String id=approval.optString("sessionId"),incident=approval.optString("incidentId");JSONObject body=new JSONObject();try{body.put("sessionId",id).put("incidentId",incident).put("accepted",accepted);}catch(Exception ignored){}
    liveExecutor.execute(()->{try{request(server,token,"/api/field/live/accept","POST",body);if(accepted)runOnUiThread(()->{if(!resumed){liveSessionId=id;liveIncidentId=incident;stopLiveCapture("Raksha Field is no longer visible.",true);return;}beginLiveCapture(id,incident);});else runOnUiThread(()->{if(liveStatus!=null)liveStatus.setText("Live request declined. Camera and microphone remain off.");});}catch(Exception e){runOnUiThread(()->{promptedLiveSessions.remove(id);if(id.equals(liveSessionId)){liveSessionId="";liveIncidentId="";}if(liveStatus!=null)liveStatus.setText("Live view did not start: "+e.getMessage());showError("Live view could not start. SOS delivery is unchanged.");});}});
  }
  private void beginLiveCapture(String sessionId,String incidentId){
    if(!hasLivePermissions()){liveSessionId=sessionId;liveIncidentId=incidentId;stopLiveCapture("Camera or microphone permission was not granted.",true);return;}
    liveSessionId=sessionId;liveIncidentId=incidentId;liveActive=true;livePanel.setVisibility(View.VISIBLE);liveStatus.setText("LIVE SHARING · Camera and microphone are on. HQ can see and hear this phone.");liveStatus.setTextColor(0xffbd4b2e);stopLiveButton.setVisibility(View.VISIBLE);
    startLiveAudio();startLiveCamera();
  }
  private void startLiveAudio(){
    try{int min=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);if(min<=0)throw new IOException("Microphone is unavailable.");AudioRecord record=new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(min*2,12800));if(record.getState()!=AudioRecord.STATE_INITIALIZED){record.release();throw new IOException("Microphone could not start.");}record.startRecording();liveAudioRecord=record;
      liveAudioThread=new Thread(()->{byte[] buffer=new byte[12800];try{while(liveActive&&record==liveAudioRecord){int filled=0;while(liveActive&&filled<buffer.length){int n=record.read(buffer,filled,buffer.length-filled);if(n<0)throw new IOException("Microphone read failed.");if(n==0)break;filled+=n;}if(filled>0&&liveActive){String audio=Base64.encodeToString(Arrays.copyOf(buffer,filled),Base64.NO_WRAP);JSONObject data=new JSONObject().put("sessionId",liveSessionId).put("chunk",audio);request(server,token,"/api/field/live/audio","POST",data);}}}catch(Exception e){if(liveActive)runOnUiThread(()->{if(liveStatus!=null)liveStatus.setText("Live audio stopped: "+e.getMessage());stopLiveCapture("Live audio connection ended.",true);});}finally{try{record.stop();}catch(Exception ignored){}record.release();}} ,"raksha-live-microphone");liveAudioThread.start();
    }catch(Exception e){stopLiveCapture("Microphone could not start: "+e.getMessage(),true);showError("Live microphone could not start. The SOS remains active.");}
  }
  private void startLiveCamera(){
    try{CameraManager manager=(CameraManager)getSystemService(CAMERA_SERVICE);if(manager==null)throw new IOException("Camera is unavailable.");String selected=null;for(String candidate:manager.getCameraIdList()){CameraCharacteristics c=manager.getCameraCharacteristics(candidate);Integer facing=c.get(CameraCharacteristics.LENS_FACING);if(facing!=null&&facing==CameraCharacteristics.LENS_FACING_BACK){selected=candidate;break;}if(selected==null)selected=candidate;}if(selected==null)throw new IOException("No camera is available.");
      CameraCharacteristics characteristics=manager.getCameraCharacteristics(selected);android.hardware.camera2.params.StreamConfigurationMap map=characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);Size[] sizes=map==null?null:map.getOutputSizes(ImageFormat.JPEG);if(sizes==null||sizes.length==0)throw new IOException("Camera capture is unavailable.");Size chosen=null;for(Size size:sizes)if(size.getWidth()<=640&&size.getHeight()<=480&&(chosen==null||size.getWidth()*size.getHeight()>chosen.getWidth()*chosen.getHeight()))chosen=size;if(chosen==null){chosen=sizes[0];for(Size size:sizes)if(size.getWidth()*size.getHeight()<chosen.getWidth()*chosen.getHeight())chosen=size;}
      liveImageReader=ImageReader.newInstance(chosen.getWidth(),chosen.getHeight(),ImageFormat.JPEG,2);liveImageReader.setOnImageAvailableListener(reader->{Image image=null;try{image=reader.acquireLatestImage();if(image==null||!liveActive)return;ByteBuffer data=image.getPlanes()[0].getBuffer();byte[] jpeg=new byte[data.remaining()];data.get(jpeg);if(jpeg.length>240000){Bitmap bitmap=BitmapFactory.decodeByteArray(jpeg,0,jpeg.length);if(bitmap!=null){ByteArrayOutputStream compressed=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.JPEG,48,compressed);jpeg=compressed.toByteArray();bitmap.recycle();}}if(jpeg.length>240000)return;String frame=Base64.encodeToString(jpeg,Base64.NO_WRAP);JSONObject payload=new JSONObject().put("sessionId",liveSessionId).put("frame",frame);liveExecutor.execute(()->{try{if(liveActive)request(server,token,"/api/field/live/frame","POST",payload);}catch(Exception e){if(liveActive)runOnUiThread(()->stopLiveCapture("Live camera connection ended.",true));}});}catch(Exception e){if(liveActive)runOnUiThread(()->stopLiveCapture("Live camera capture ended.",true));}finally{if(image!=null)image.close();}},handler);
      manager.openCamera(selected,new CameraDevice.StateCallback(){public void onOpened(CameraDevice camera){if(!liveActive){camera.close();return;}liveCamera=camera;try{camera.createCaptureSession(Arrays.asList(liveImageReader.getSurface()),new CameraCaptureSession.StateCallback(){public void onConfigured(CameraCaptureSession session){if(!liveActive){session.close();return;}liveCameraSession=session;captureLiveFrame();}public void onConfigureFailed(CameraCaptureSession session){session.close();stopLiveCapture("Camera could not configure.",true);}},handler);}catch(Exception e){stopLiveCapture("Camera session failed.",true);}}public void onDisconnected(CameraDevice camera){camera.close();if(liveActive)stopLiveCapture("Camera disconnected.",true);}public void onError(CameraDevice camera,int error){camera.close();if(liveActive)stopLiveCapture("Camera error.",true);}},handler);
    }catch(Exception e){stopLiveCapture("Camera could not start: "+e.getMessage(),true);showError("Live camera could not start. The SOS remains active.");}
  }
  private void captureLiveFrame(){
    if(!liveActive||liveCamera==null||liveCameraSession==null||liveImageReader==null)return;
    try{CaptureRequest.Builder request=liveCamera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);request.addTarget(liveImageReader.getSurface());request.set(CaptureRequest.JPEG_QUALITY,(byte)52);liveCameraSession.capture(request.build(),new CameraCaptureSession.CaptureCallback(){public void onCaptureCompleted(CameraCaptureSession session,CaptureRequest request,android.hardware.camera2.TotalCaptureResult result){if(liveActive)handler.postDelayed(()->captureLiveFrame(),1100);}public void onCaptureFailed(CameraCaptureSession session,CaptureRequest request,CaptureFailure failure){if(liveActive)handler.postDelayed(()->captureLiveFrame(),1800);}},handler);}catch(Exception e){if(liveActive)stopLiveCapture("Camera capture failed.",true);}
  }
  private void stopLiveCapture(String message,boolean notifyServer){
    String oldSession=liveSessionId;if(oldSession.isEmpty()&&!liveActive)return;liveActive=false;liveSessionId="";liveIncidentId="";
    try{if(liveCameraSession!=null)liveCameraSession.close();}catch(Exception ignored){}liveCameraSession=null;try{if(liveCamera!=null)liveCamera.close();}catch(Exception ignored){}liveCamera=null;try{if(liveImageReader!=null)liveImageReader.close();}catch(Exception ignored){}liveImageReader=null;
    AudioRecord record=liveAudioRecord;liveAudioRecord=null;if(record!=null){try{if(record.getRecordingState()==AudioRecord.RECORDSTATE_RECORDING)record.stop();}catch(Exception ignored){}}
    if(liveStatus!=null){liveStatus.setText(message+" Camera and microphone are off.");liveStatus.setTextColor(MUTED);}if(stopLiveButton!=null)stopLiveButton.setVisibility(View.GONE);
    if(notifyServer&&!oldSession.isEmpty())try{liveExecutor.execute(()->{try{request(server,token,"/api/field/live/stop","POST",new JSONObject().put("sessionId",oldSession));}catch(Exception ignored){}});}catch(Exception ignored){}
  }
  private void requestGps(){
    if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},7);return;}
    stopGps();locationManager=(LocationManager)getSystemService(LOCATION_SERVICE);gpsStatus.setText("Finding location… You can still send a written landmark.");
    locationListener=new LocationListener(){public void onLocationChanged(Location loc){if(System.currentTimeMillis()-loc.getTime()>120000)return;try{coordinates=new JSONObject().put("lat",loc.getLatitude()).put("lng",loc.getLongitude()).put("accuracy",loc.getAccuracy());coordinatesAt=loc.getTime();gpsStatus.setText("GPS attached: "+loc.getLatitude()+", "+loc.getLongitude()+" (±"+(int)loc.getAccuracy()+" m)");}catch(Exception ignored){}stopGps();}public void onProviderEnabled(String p){}public void onProviderDisabled(String p){}public void onStatusChanged(String p,int s,Bundle b){}};
    try{boolean any=false;for(String provider:new String[]{LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER})if(locationManager.isProviderEnabled(provider)){locationManager.requestLocationUpdates(provider,1000,0,locationListener);any=true;}if(!any)gpsStatus.setText("Location services are off. Enter a landmark instead.");handler.postDelayed(()->{if(locationListener!=null){stopGps();gpsStatus.setText("Could not get a fresh location. Enter a landmark or try GPS again.");}},30000);}catch(SecurityException e){gpsStatus.setText("Location permission denied. Enter a landmark instead.");}
  }
  private void stopGps(){if(locationManager!=null&&locationListener!=null)locationManager.removeUpdates(locationListener);locationListener=null;}
  @Override public void onRequestPermissionsResult(int r,String[] permissions,int[] grants){super.onRequestPermissionsResult(r,permissions,grants);if(r==7){if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED)requestGps();else gpsStatus.setText("GPS permission denied. Written location still works.");}else if(r==NOTIFICATION_PERMISSION_REQUEST){boolean granted=grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED;prefs.edit().putBoolean("statusNotifications",granted).apply();if(granted)showError("Status notifications are enabled with sound and vibration.");else showError("Notifications are off. You can still use Shake SOS and the countdown alarm while the app is open.");}else if(r==LIVE_PERMISSION_REQUEST){JSONObject approval=pendingLiveApproval;String incidentId=pendingPermissionIncidentId;pendingLiveApproval=null;pendingPermissionIncidentId="";if(hasLivePermissions()){saveLiveConsent(incidentId);if(approval!=null)respondToLive(approval,true);else showNextLiveConsent();}else{if(approval!=null)respondToLive(approval,false);showError("Camera and microphone permission were not granted. SOS is still active.");showNextLiveConsent();}}}
  @Override protected void onResume(){super.onResume();resumed=true;updateSensorRegistration();handler.post(poll);handler.post(livePoll);showNextLiveConsent();}
  @Override protected void onPause(){super.onPause();resumed=false;handler.removeCallbacks(poll);handler.removeCallbacks(livePoll);stopGps();updateSensorRegistration();if(liveActive)stopLiveCapture("Raksha Field left the screen.",true);}
  @Override protected void onDestroy(){if(liveActive)stopLiveCapture("Raksha Field closed.",true);super.onDestroy();worker.shutdown();liveExecutor.shutdown();handler.removeCallbacksAndMessages(null);stopEmergencyAlarm();if(sensorManager!=null&&sensorRegistered)sensorManager.unregisterListener(motionListener);if(toneGenerator!=null){try{toneGenerator.release();}catch(Exception ignored){}}}
}
