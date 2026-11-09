package site.dotas.zapencomendas;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract.CommonDataKinds.Phone;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import org.json.JSONArray;
import org.json.JSONObject;

/** Reads only the phone row explicitly granted by Android's contact picker. */
final class ContactPicker {
    private final MainActivity activity;
    private final ActivityResultLauncher<Intent> launcher;
    private String pending;

    ContactPicker(MainActivity activity){
        this.activity=activity;
        launcher=activity.registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),result->{
            if(pending==null)return;
            if(result.getResultCode()!=Activity.RESULT_OK){finish(null,null);return;}
            Uri uri=result.getData()==null?null:result.getData().getData();
            if(uri==null||!"content".equals(uri.getScheme())){finish(null,"Não foi possível ler o contato escolhido.");return;}
            try(Cursor cursor=activity.getContentResolver().query(uri,new String[]{Phone.DISPLAY_NAME,Phone.NUMBER},null,null,null)){
                if(cursor==null||!cursor.moveToFirst()){finish(null,"O contato escolhido não possui telefone disponível.");return;}
                String name=cursor.getString(0),number=cursor.getString(1);
                JSONObject contact=new JSONObject().put("name",new JSONArray().put(name==null?"":name)).put("tel",new JSONArray().put(number==null?"":number));
                finish(contact,null);
            }catch(Exception e){finish(null,"Não foi possível ler o contato escolhido. Tente novamente.");}
        });
    }
    void pick(String id){
        if(id==null||id.length()>100||id.isEmpty())return;
        if(pending!=null){reply(id,null,"Já existe uma seleção de contato aberta.");return;}
        pending=id;
        try{launcher.launch(new Intent(Intent.ACTION_PICK,Phone.CONTENT_URI));}
        catch(Exception e){finish(null,"Nenhum aplicativo de contatos está disponível neste aparelho.");}
    }
    private void finish(JSONObject contact,String error){String id=pending;pending=null;reply(id,contact,error);}
    private void reply(String id,JSONObject contact,String error){
        if(activity.getBridge()==null||id==null)return;
        try{
            JSONObject payload=new JSONObject().put("id",id).put("contacts",contact==null?new JSONArray():new JSONArray().put(contact));
            if(error!=null)payload.put("error",error);
            activity.getBridge().getWebView().evaluateJavascript("window.ZapContacts&&window.ZapContacts.receive("+payload+")",null);
        }catch(Exception ignored){}
    }
}
